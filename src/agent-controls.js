/**
 * AgentControls — The bridge between commands (text/LLM) and the Agent body.
 * Every function returns a result object for feedback.
 */
export class AgentControls {
    constructor(agent, world) {
        this.agent = agent;
        this.world = world;
    }

    /**
     * Available functions (schema for LLM / console)
     */
    static getFunctionSchemas() {
        return [
            {
                name: 'moveTo',
                description: 'Move the agent to specific world coordinates (x, z)',
                parameters: { x: 'number', z: 'number' }
            },
            {
                name: 'moveForward',
                description: 'Move the agent forward by a given distance',
                parameters: { distance: 'number' }
            },
            {
                name: 'turnTo',
                description: 'Rotate the agent to face a specific angle in degrees',
                parameters: { angleDeg: 'number' }
            },
            {
                name: 'lookAt',
                description: 'Turn the agent to face a specific object by its ID',
                parameters: { objectId: 'string' }
            },
            {
                name: 'interact',
                description: 'Interact with a nearby object by its ID',
                parameters: { objectId: 'string' }
            },
            {
                name: 'say',
                description: 'Make the agent say something (speech bubble)',
                parameters: { text: 'string' }
            },
            {
                name: 'scan',
                description: 'Scan the area and list all visible objects with distances',
                parameters: {}
            },
            {
                name: 'getState',
                description: 'Get the agent\'s current position, rotation, and status',
                parameters: {}
            }
        ];
    }

    /**
     * Execute a function by name with args
     */
    execute(funcName, args = {}) {
        switch (funcName) {
            case 'moveTo':
                return this.moveTo(args.x, args.z);
            case 'moveForward':
                return this.moveForward(args.distance);
            case 'turnTo':
                return this.turnTo(args.angleDeg);
            case 'lookAt':
                return this.lookAt(args.objectId);
            case 'interact':
                return this.interact(args.objectId);
            case 'say':
                return this.say(args.text);
            case 'scan':
                return this.scan();
            case 'getState':
                return this.getState();
            default:
                return { error: `Unknown function: ${funcName}` };
        }
    }

    /* ---- Individual Functions ---- */

    moveTo(x, z) {
        if (typeof x !== 'number' || typeof z !== 'number') {
            return { error: 'moveTo requires numeric x, z parameters' };
        }
        // Clamp to world bounds
        x = Math.max(-24, Math.min(24, x));
        z = Math.max(-24, Math.min(24, z));
        const result = this.agent.moveTo(x, z);
        return { ...result, message: `Walking to (${x}, ${z})` };
    }

    moveForward(distance) {
        if (typeof distance !== 'number') {
            return { error: 'moveForward requires numeric distance' };
        }
        const result = this.agent.moveForward(distance);
        return { ...result, message: `Moving forward ${distance} units` };
    }

    turnTo(angleDeg) {
        if (typeof angleDeg !== 'number') {
            return { error: 'turnTo requires numeric angle in degrees' };
        }
        const result = this.agent.turnTo(angleDeg);
        return { ...result, message: `Turned to ${angleDeg}°` };
    }

    lookAt(objectId) {
        const obj = this.world.getObject(objectId);
        if (!obj) {
            return { error: `Object '${objectId}' not found. Use scan() to see available objects.` };
        }
        const pos = obj.mesh.position;
        this.agent.lookAtPosition(pos.x, pos.z);
        return { action: 'lookAt', objectId, status: 'done', message: `Now facing ${objectId}` };
    }

    interact(objectId) {
        const obj = this.world.getObject(objectId);
        if (!obj) {
            return { error: `Object '${objectId}' not found` };
        }
        if (!obj.interactable) {
            return { error: `Object '${objectId}' is not interactable` };
        }
        // Check distance
        const agentPos = this.agent.position;
        const objPos = obj.mesh.position;
        const dist = Math.sqrt(
            (agentPos.x - objPos.x) ** 2 + (agentPos.z - objPos.z) ** 2
        );
        if (dist > 3) {
            return {
                error: `Too far from '${objectId}' (distance: ${dist.toFixed(1)}). Move closer first.`,
                distance: parseFloat(dist.toFixed(1))
            };
        }
        // Visual feedback: bounce the object
        const origY = objPos.y;
        obj.mesh.position.y += 0.5;
        setTimeout(() => { obj.mesh.position.y = origY; }, 300);

        return {
            action: 'interact',
            objectId,
            objectType: obj.type,
            description: obj.description,
            status: 'done',
            message: `Interacted with ${objectId} (${obj.description})`
        };
    }

    say(text) {
        if (!text || typeof text !== 'string') {
            return { error: 'say requires a text string' };
        }
        const result = this.agent.say(text);
        return { ...result, message: `Said: "${text}"` };
    }

    scan() {
        const agentPos = this.agent.position;
        const objects = this.world.getObjectsData();
        const scanned = objects.map(obj => {
            const dist = Math.sqrt(
                (agentPos.x - obj.position.x) ** 2 + (agentPos.z - obj.position.z) ** 2
            );
            return {
                ...obj,
                distance: parseFloat(dist.toFixed(2))
            };
        });
        scanned.sort((a, b) => a.distance - b.distance);
        return {
            action: 'scan',
            agentPosition: {
                x: parseFloat(agentPos.x.toFixed(2)),
                z: parseFloat(agentPos.z.toFixed(2))
            },
            objects: scanned,
            message: `Found ${scanned.length} objects`
        };
    }

    getState() {
        const state = this.agent.getState();
        return { ...state, action: 'getState', message: `Agent at (${state.position.x}, ${state.position.z}), facing ${state.rotationDeg}°, state: ${state.state}` };
    }
}
