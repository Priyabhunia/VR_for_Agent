/**
 * ConsoleUI — Interactive command console for the agent
 */
export class ConsoleUI {
    constructor(controls) {
        this.controls = controls;
        this.history = [];
        this.historyIndex = -1;
        this.onLLMModeChange = null; // callback

        this.output = document.getElementById('console-output');
        this.input = document.getElementById('console-input');
        this.llmConfig = document.getElementById('llm-config');
        this.btnManual = document.getElementById('btn-manual');
        this.btnLlm = document.getElementById('btn-llm');

        this._setup();
        this.log('system', 'Agent Console initialized. Type commands or use quick actions.');
        this.log('system', 'Try: agent.scan() | agent.moveTo(5, 3) | agent.say("hello")');
    }

    _setup() {
        // Command input
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.input.value.trim();
                if (cmd) {
                    this.executeCommand(cmd);
                    this.history.push(cmd);
                    this.historyIndex = this.history.length;
                    this.input.value = '';
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.input.value = this.history[this.historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.input.value = this.history[this.historyIndex];
                } else {
                    this.historyIndex = this.history.length;
                    this.input.value = '';
                }
            }
        });

        // Quick action buttons
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cmd = btn.dataset.cmd;
                if (cmd) this.executeCommand(cmd);
            });
        });

        // Mode toggle
        this.btnManual.addEventListener('click', () => this._setMode('manual'));
        this.btnLlm.addEventListener('click', () => this._setMode('llm'));
    }

    _setMode(mode) {
        if (mode === 'manual') {
            this.btnManual.classList.add('active');
            this.btnLlm.classList.remove('active');
            this.llmConfig.classList.add('hidden');
        } else {
            this.btnLlm.classList.add('active');
            this.btnManual.classList.remove('active');
            this.llmConfig.classList.remove('hidden');
        }
        if (this.onLLMModeChange) this.onLLMModeChange(mode);
    }

    executeCommand(cmdStr) {
        this.log('cmd', `› ${cmdStr}`);

        try {
            // Parse "agent.funcName(args)" pattern
            const match = cmdStr.match(/^agent\.(\w+)\((.*)\)$/s);
            if (!match) {
                this.log('error', 'Invalid format. Use: agent.functionName(args)');
                return null;
            }

            const funcName = match[1];
            const argsStr = match[2].trim();

            // Parse arguments
            let args = {};
            if (argsStr) {
                // Handle different function signatures
                const schemas = this.controls.constructor.getFunctionSchemas();
                const schema = schemas.find(s => s.name === funcName);
                if (!schema) {
                    this.log('error', `Unknown function: ${funcName}`);
                    return null;
                }

                const paramNames = Object.keys(schema.parameters);
                if (paramNames.length === 1 && Object.values(schema.parameters)[0] === 'string') {
                    // Single string param — treat whole thing as the string
                    args[paramNames[0]] = argsStr.replace(/^['"]|['"]$/g, '');
                } else {
                    // Parse as comma-separated values
                    const values = argsStr.split(',').map(v => v.trim());
                    paramNames.forEach((name, i) => {
                        if (i < values.length) {
                            const val = values[i].replace(/^['"]|['"]$/g, '');
                            args[name] = isNaN(Number(val)) ? val : Number(val);
                        }
                    });
                }
            }

            const result = this.controls.execute(funcName, args);

            if (result.error) {
                this.log('error', result.error);
            } else {
                this.log('result', JSON.stringify(result, null, 2));
            }
            return result;

        } catch (err) {
            this.log('error', `Error: ${err.message}`);
            return null;
        }
    }

    log(type, message) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        const span = document.createElement('span');
        span.className = `log-${type}`;
        span.textContent = message;
        entry.appendChild(span);
        this.output.appendChild(entry);
        this.output.scrollTop = this.output.scrollHeight;
    }
}
