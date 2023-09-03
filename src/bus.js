'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bus = exports.Connector = exports.Result = exports.Query = exports.RemoteEvent = exports.Event = void 0;
const mqtt = __importStar(require("mqtt"));
class Event {
    constructor(name, data = null) {
        this.name = name;
        this.data = data;
    }
}
exports.Event = Event;
class RemoteEvent extends Event {
    constructor(source, name, data) {
        super(name, data);
        this.source = source;
    }
}
exports.RemoteEvent = RemoteEvent;
class Query {
    constructor(name, data) {
        this.name = name;
        this.data = data;
    }
}
exports.Query = Query;
class Result {
    constructor(code, data) {
        this.code = code;
        this.data = data;
    }
}
exports.Result = Result;
class Connector {
    static connect(busId, host) {
        return __awaiter(this, void 0, void 0, function* () {
            const connection = mqtt.connect('mqtt://' + host);
            return new Promise(resolve => {
                connection.on('connect', () => {
                    resolve(new Bus(busId, connection));
                });
            });
        });
    }
}
exports.Connector = Connector;
class Bus {
    constructor(busId, client) {
        this.busId = busId;
        this.client = client;
        this.handlers = new Map();
        this.queryHandlers = new Map();
        this.waiting = new Map();
        if (client.connected) {
            this.handleConnected();
        }
        this.client.on('connect', this.handleConnected.bind(this));
        this.client.on('message', this.handleMessage.bind(this));
        this.client.subscribe(`bus/${this.busId}/rpc`);
        this.client.subscribe(`bus/+/events`);
    }
    handleConnected() {
        // console.log('Bus: connected');
        // this.client.subscribe(`bus/${this.busId}/rpc`);
        // this.client.subscribe(`bus/+/events`);
    }
    handleMessage(topic, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const object = JSON.parse(message.toString());
            const command = object;
            // Skip commands from self
            if (command.src === this.busId) {
                return;
            }
            // console.log('Bus command received', command);
            switch (command.x) {
                case 'event': {
                    const event = object;
                    this.handleEvent(new RemoteEvent(command.src, event.name, event.data));
                    break;
                }
                case 'query': {
                    const query = object;
                    const result = yield this.handleQuery(new Query(query.name, query.data));
                    this.client.publish(`bus/${command.src}/rpc`, JSON.stringify({
                        x: 'result',
                        src: this.busId,
                        dst: command.src,
                        id: query.id,
                        code: result.code,
                        data: result.data
                    }));
                    break;
                }
                case 'result': {
                    const result = object;
                    this.handleResult(result.id, new Result(result.code, result.data));
                    break;
                }
            }
        });
    }
    handleQuery(query) {
        const handler = this.queryHandlers.get(query.name);
        if (!handler) {
            return Promise.resolve(new Result(0, { error: 'Bad query' }));
        }
        return handler(query);
    }
    handleEvent(event) {
        this.handlers.forEach((handlers, name) => {
            if (event.name === name) {
                handlers.forEach(handler => handler(event));
            }
        });
    }
    handleResult(id, result) {
        var _a;
        const handler = (_a = this.waiting.get(id)) !== null && _a !== void 0 ? _a : null;
        if (handler === null) {
            console.log('No queries waiting result', result);
            return;
        }
        this.waiting.delete(id);
        handler(result);
    }
    dispatch(event) {
        this.client.publish(`bus/${this.busId}/events`, JSON.stringify({ src: this.busId, x: 'event', name: event.name, data: event.data }));
    }
    subscribe(event, handler) {
        var _a;
        if (!this.handlers.has(event)) {
            this.handlers.set(event, [handler]);
        }
        else {
            (_a = this.handlers.get(event)) === null || _a === void 0 ? void 0 : _a.push(handler);
        }
    }
    on(query, handler) {
        this.queryHandlers.set(query, handler);
    }
    execute(busId, query) {
        return __awaiter(this, void 0, void 0, function* () {
            const id = Date.now();
            this.client.publish(`bus/${busId}/rpc`, JSON.stringify({
                x: 'query',
                src: this.busId,
                dst: busId,
                id: id,
                name: query.name,
                data: query.data
            }));
            return new Promise(resolve => {
                this.waiting.set(id, (result) => {
                    resolve(result);
                });
                setTimeout(() => {
                    this.waiting.delete(id);
                    resolve(new Result(-1, { error: 'Timeout' }));
                }, 5000);
            });
        });
    }
}
exports.Bus = Bus;
//# sourceMappingURL=bus.js.map