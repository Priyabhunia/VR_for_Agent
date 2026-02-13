import { World } from './world.js';
import { Agent } from './agent.js';
import { AgentControls } from './agent-controls.js';
import { ConsoleUI } from './console.js';

/**
 * Main entry — wires everything together
 */

// Init world
const canvas = document.getElementById('world-canvas');
const world = new World(canvas);

// Init agent
const agent = new Agent(world.scene);

// Init control bridge
const controls = new AgentControls(agent, world);

// Init console
const consoleUI = new ConsoleUI(controls);

// Expose globally for debugging
window.agent = controls;
window.world = world;

// HUD elements
const statusDot = document.querySelector('.status-dot');
const stateText = document.getElementById('agent-state-text');
const posDisplay = document.getElementById('position-display');
const speechBubble = document.getElementById('speech-bubble');
const speechText = document.getElementById('speech-text');
const btnFollow = document.getElementById('btn-follow-agent');

// Follow button toggle
btnFollow.addEventListener('click', () => {
    world.toggleFollowAgent();
});
// Sync button style when follow state changes (e.g. auto-disabled by pan)
world._onFollowChange = (enabled) => {
    btnFollow.classList.toggle('active', enabled);
};

// LLM mode UI
const btnStartLlm = document.getElementById('btn-start-llm');
const btnStopLlm = document.getElementById('btn-stop-llm');
// Ollama runs locally — no API key needed
const goalInput = document.getElementById('llm-goal-input');

let llmRunning = false;
let llmAbort = null;

consoleUI.onLLMModeChange = (mode) => {
    if (mode === 'manual' && llmRunning) {
        stopLLM();
    }
};

btnStartLlm.addEventListener('click', () => startLLM());
btnStopLlm.addEventListener('click', () => stopLLM());

async function startLLM() {
    const goal = goalInput.value.trim();
    if (!goal) {
        consoleUI.log('error', 'Please give the agent a goal');
        return;
    }

    llmRunning = true;
    btnStartLlm.classList.add('hidden');
    btnStopLlm.classList.remove('hidden');
    consoleUI.log('system', `🤖 LLM Agent started with goal: "${goal}"`);

    // Send initial request to Python backend
    llmAbort = new AbortController();
    try {
        await runLLMLoop(goal, llmAbort.signal);
    } catch (err) {
        if (err.name !== 'AbortError') {
            consoleUI.log('error', `LLM error: ${err.message}`);
        }
    }
    stopLLM();
}

function stopLLM() {
    llmRunning = false;
    if (llmAbort) llmAbort.abort();
    btnStopLlm.classList.add('hidden');
    btnStartLlm.classList.remove('hidden');
    consoleUI.log('system', '🛑 LLM Agent stopped');
}

async function runLLMLoop(goal, signal) {
    const maxSteps = 20;

    for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) break;

        // Wait for agent to finish current action
        while (agent.isMoving) {
            await new Promise(r => setTimeout(r, 200));
            if (signal.aborted) return;
        }

        // Get current state
        const state = controls.scan();

        // Call Python backend
        consoleUI.log('llm', `[Step ${step + 1}] Thinking...`);

        const response = await fetch('http://localhost:8000/agent/think', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                goal: goal,
                world_state: state,
                agent_state: controls.getState(),
                step: step
            }),
            signal
        });

        if (!response.ok) {
            throw new Error(`Backend error: ${response.status}`);
        }

        const data = await response.json();

        if (data.thought) {
            consoleUI.log('llm', `💭 ${data.thought}`);
        }

        if (data.actions && data.actions.length > 0) {
            for (const action of data.actions) {
                consoleUI.log('llm', `⚡ ${action.function}(${JSON.stringify(action.args)})`);
                const result = controls.execute(action.function, action.args);
                if (result.error) {
                    consoleUI.log('error', result.error);
                } else {
                    consoleUI.log('result', result.message || JSON.stringify(result));
                }
                // Wait a bit between actions for visual feedback
                await new Promise(r => setTimeout(r, 800));
                // Wait for movement to complete
                while (agent.isMoving) {
                    await new Promise(r => setTimeout(r, 200));
                    if (signal.aborted) return;
                }
            }
        }

        if (data.done) {
            consoleUI.log('llm', '✅ Agent completed its goal!');
            break;
        }

        // Small delay between steps
        await new Promise(r => setTimeout(r, 500));
    }
}

// ---- Speech bubble positioning ----
function updateSpeechBubble() {
    if (agent.state === 'talking') {
        const agentWorldPos = agent.position.clone();
        agentWorldPos.y = 2.3;
        const screenPos = agentWorldPos.project(world.camera);
        const rect = canvas.getBoundingClientRect();
        const x = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left;
        const y = (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top;
        speechBubble.style.left = x + 'px';
        speechBubble.style.top = y + 'px';
        speechBubble.classList.remove('hidden');
    } else {
        speechBubble.classList.add('hidden');
    }
}

// Watch for say() calls to update speech text
const origSay = controls.say.bind(controls);
controls.say = function (text) {
    speechText.textContent = text;
    return origSay(text);
};

// ---- Main loop ----
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Update agent
    agent.update(dt);

    // Follow agent with camera
    world.followAgent(agent.position);

    // Update HUD
    const agentState = agent.state;
    stateText.textContent = agentState.charAt(0).toUpperCase() + agentState.slice(1);
    statusDot.className = `status-dot ${agentState !== 'idle' ? agentState : ''}`;

    const pos = agent.position;
    posDisplay.textContent = `Pos: ${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;

    updateSpeechBubble();

    // Render
    world.render();
}

animate();

consoleUI.log('system', '🌍 Virtual world loaded. Agent ready.');
consoleUI.log('system', '📡 For LLM mode, start the Python backend: python server.py');
