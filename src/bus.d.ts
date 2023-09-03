import * as mqtt from "mqtt";
export declare class Event {
    readonly name: string;
    readonly data: any;
    constructor(name: string, data?: any);
}
export declare class RemoteEvent extends Event {
    readonly source: string;
    constructor(source: string, name: string, data: any);
}
export declare class Query {
    readonly name: string;
    readonly data: any;
    constructor(name: string, data: any);
}
export declare class Result {
    readonly code: number;
    readonly data: Map<string, any>;
    constructor(code: number, data: any);
}
export type EventHandler = (arg1: RemoteEvent) => void;
export type QueryHandler = (arg1: Query) => Promise<Result>;
export declare class Connector {
    static connect(busId: string, host: string): Promise<Bus>;
}
export declare class Bus {
    private readonly busId;
    private readonly client;
    private handlers;
    private queryHandlers;
    private waiting;
    constructor(busId: string, client: mqtt.MqttClient);
    private handleConnected;
    private handleMessage;
    private handleQuery;
    private handleEvent;
    private handleResult;
    dispatch(event: Event): void;
    subscribe(event: string, handler: EventHandler): void;
    on(query: string, handler: QueryHandler): void;
    execute(busId: string, query: Query): Promise<Result>;
}
