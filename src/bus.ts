'use strict';

import * as mqtt from "mqtt";

export class Event<T>
{
    constructor(
        public readonly name: string,
        public readonly data: T
    ) {
    }
}

export class RemoteEvent<T> extends Event<T>
{
    constructor(
        public readonly source: string,
        name: string,
        data: T
    ) {
        super(name, data);
    }
}

export class Query<T>
{
    public readonly name: string;
    public readonly data: T;

    constructor(name: string, data: T) {
        this.name = name;
        this.data = data;
    }
}

export class Result {
    public readonly code: number;
    public readonly data: Map<string, any>;

    constructor(code: number, data: any) {
        this.code = code;
        this.data = data;
    }
}

export type EventHandler = (arg1: RemoteEvent<any>) => void;
export type QueryHandler = (arg1: Query<any>) => Promise<Result>;

export class Connector {
    static async connect(busId: string, host: string): Promise<Bus>
    {
        const connection = mqtt.connect('mqtt://' + host);

        return new Promise<Bus>(resolve => {
            connection.on('connect', () => {
                resolve(new Bus(busId, connection));
            });
        });
    }
}

export class Bus
{
    private handlers: Map<string, Array<EventHandler>>;

    private queryHandlers: Map<string, QueryHandler>;

    private waiting: Map<number, (arg0: Result) => void>

    constructor(
        private readonly busId: string,
        private readonly client: mqtt.MqttClient
    )
    {
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

    private handleConnected(): void
    {
        // console.log('Bus: connected');
        // this.client.subscribe(`bus/${this.busId}/rpc`);
        // this.client.subscribe(`bus/+/events`);
    }

    private async handleMessage(topic: string, message: Buffer) {
        const object = JSON.parse(message.toString());
        const command: { x: string, src: string, dst: string } = object;

        // Skip commands from self
        if (command.src === this.busId) {
            return;
        }

        // console.log('Bus command received', command);

        switch (command.x) {
            case 'event': {
                const event: { name: string, data: any } = object;
                this.handleEvent(new RemoteEvent(command.src, event.name, event.data));
                break;
            }

            case 'query': {
                const query: { id: number, name: string, data: any } = object;
                const result = await this.handleQuery(new Query(query.name, query.data));
                this.client.publish(
                    `bus/${command.src}/rpc`,
                    JSON.stringify({
                        x: 'result',
                        src: this.busId,
                        dst: command.src,
                        id: query.id,
                        code: result.code,
                        data: result.data
                    })
                );
                break;
            }

            case 'result': {
                const result: { id: number, code: number, data: any } = object;
                this.handleResult(result.id, new Result(result.code, result.data));
                break;
            }
        }
    }

    private handleQuery(query: Query<any>): Promise<Result>
    {
        const handler = this.queryHandlers.get(query.name);

        if (!handler) {
            return Promise.resolve(new Result(0, {error: 'Bad query'}));
        }

        return handler(query);
    }

    private handleEvent(event: RemoteEvent<any>): void
    {
        this.handlers.forEach((handlers, name) => {
            if (event.name === name) {
                handlers.forEach(handler => handler(event));
            }
        })
    }

    private handleResult(id: number, result: Result): void
    {
        const handler = this.waiting.get(id) ?? null;

        if (handler === null) {
            console.log('No queries waiting result', result);
            return;
        }

        this.waiting.delete(id);
        handler(result);
    }

    public dispatch(event: Event<any>): void
    {
        this.client.publish(`bus/${this.busId}/events`, JSON.stringify({src: this.busId, x: 'event', name: event.name, data: event.data}));
    }

    public subscribe(event: string, handler: EventHandler)
    {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, [handler]);
        } else {
            this.handlers.get(event)?.push(handler);
        }
    }

    public on(query: string, handler: QueryHandler): void
    {
        this.queryHandlers.set(query, handler);
    }

    public async execute(busId: string, query: Query<any>): Promise<Result>
    {
        const id = Date.now();

        this.client.publish(`bus/${busId}/rpc`, JSON.stringify({
            x: 'query',
            src: this.busId,
            dst: busId,
            id: id,
            name: query.name,
            data: query.data
        }));

        return new Promise<Result>(resolve => {
            this.waiting.set(id, (result: Result) => {
                resolve(result);
            });

            setTimeout(() => {
                this.waiting.delete(id);
                resolve(new Result(-1, {error: 'Timeout'}))
            }, 5000);
        });
    }
}