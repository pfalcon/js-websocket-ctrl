// ws_ctrl.js - Forward JS events and actions over WebSocket

const WsCtrl = (function() {

    // Flags to synchonize sending "init" event
    let isDomReady = false;
    let isWsOpen = false;

    let socket;
    let eventTrascoders = [];
    let debug = true;


    /**
     * Assigns a value to a (nested) property of a GLOBAL variable, or variable itself.
     *
     * @param {string} fullPath - The complete property path (e.g., 'DATA[0].array[INDEX_MAP.item]').
     * @param {*} value - The value to assign.
     */
    function dynaAssign(lhs, value) {
        let parentPath;
        let finalKey; // The actual key used for assignment

        // 1. Check the last character to determine the assignment type.
        const lastChar = lhs[lhs.length - 1];

        if (lastChar === ']') {
            // Array access case (requires eval on index expr)

            let bracketCount = 0;
            let splitIndex = -1;

            // Iterate backwards to find the matching opening bracket for the final expression.
            for (let i = lhs.length - 1; i >= 0; i--) {
                const char = lhs[i];

                if (char === ']') {
                    bracketCount++;
                } else if (char === '[') {
                    bracketCount--;
                    if (bracketCount === 0) {
                        // Found the start of the final array access expression.
                        splitIndex = i;
                        break;
                    }
                }
            }

            // Final key expression: Content inside the brackets (e.g., 'INDEX_MAP.item')
            const finalKeyExpression = lhs.substring(splitIndex + 1, lhs.length - 1);
            finalKey = globalThis.eval(finalKeyExpression);

            // Parent path: Everything before the final array access.
            parentPath = lhs.substring(0, splitIndex);

        } else {
            // Property access case (literal key, no eval needed for key)

            const lastDot = lhs.lastIndexOf('.');
            if (lastDot === -1) {
                // No path, direct assignment to global variable (e.g., 'DATA').
                globalThis[lhs] = value;
                return;
            }

            // Parent path: Everything up to the last dot.
            parentPath = lhs.substring(0, lastDot);

            // Final key: Literal key after the last dot. No eval needed.
            finalKey = lhs.substring(lastDot + 1);
        }

        // 3. EVAL #1 (Always Required): Get the reference to the immediate parent object.
        const parentObject = globalThis.eval(parentPath);

        // 4. Final assignment using the resolved parent reference and key.
        parentObject[finalKey] = value;
    }


    // Pass e.g. 'ws://localhost:8080'
    function init(ws_url) {
        socket = new WebSocket(ws_url);

        socket.onopen = (event) => {
            console.log("WsCtrl: WebSocket connected to " + ws_url);
            isWsOpen = true;
            sendInitEvent();
        };

        socket.onmessage = (event) => {
            if (debug)
                console.log('WsCtrl: Received: ', event.data);

            if (event.data.startsWith("{")) {
                const data = JSON.parse(event.data);
                switch (data.msg_type) {
                    case 'listen': {
                        eval(data.obj)[data.method](data.event_type, sendEvent);
                        break;
                    }
                    case 'call': {
                        const evaledObj = eval(data.obj);
                        const evaluatedArgs = data.args.map(arg => eval(arg));
                        const res = evaledObj[data.method](...evaluatedArgs);
                        if (debug)
                            console.log("WsCtrl: Call result:", res);
                        //const message = JSON.stringify({msg_type: "res", msg_id: data.msg_id, res: res});
                        //socket.send(message);
                        break;
                    }
                    case 'assign': {
                        dynaAssign(data.lhs, data.value)
                        break;
                    }
                    case 'exec': {
                        // eval expression and ignore result
                        eval(data.expr);
                        break;
                    }
                    case 'eval': {
                        // eval expression and send back result
                        const res = eval(data.expr);
                        sendMsg({msg_type: "res", msg_id: data.msg_id, res: res});
                        break;
                    }
                }
            }
        }

        socket.onerror = (error) => {
            console.error("WsCtrl: WebSocket Error:", error);
        }
    }


    function addEventTranscoder(f) {
        eventTrascoders.push(f);
    }


    function sendMsg(msg) {
        if (debug)
            console.log("WsCtrl: Sending:", msg)
        socket.send(JSON.stringify(msg));
    }


    function sendEvent(event) {
        if (debug)
            console.log("WsCtrl: sendEvent:", event)

        const edata = {
            msg_type: 'event',
            _class_: event.constructor.name,
            type: event.type,
            clientX: event.clientX,
            clientY: event.clientY,
        };

        if (typeof event.target === 'object') {
            edata.targetId = event.target.id;
            edata.targetTag = event.target.tagName;
            edata.value = event.target.value;
        }

        for (const f of eventTrascoders) {
            f.call(null, event, edata);
        }

        if (socket.readyState === WebSocket.OPEN) {
            sendMsg(edata);
        } else {
            console.warn("WsCtrl: WebSocket not open, cannot send event:", event.type);
        }
    }


    function sendInitEvent() {
        // Send event only when both DOM and websockets are ready
        if (isDomReady && isWsOpen) {
            sendMsg({msg_type: "init"});
        }
    }


    function setDebug(flag) {
        debug = flag;
    }


    document.addEventListener('DOMContentLoaded', (event) => {
        isDomReady = true;
        sendInitEvent();
    });


    return {
        init: init,
        addEventTranscoder: addEventTranscoder,
        setDebug: setDebug,
    }

})();
