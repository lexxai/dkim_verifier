declare module browser {
    declare module libunbound {
        const configure: (
            getNameserversFromOS: boolean,
            nameServer: string,
            dnssecTrustAnchor: string,
            path: string,
            pathRelToProfileDir: boolean,
            debug: boolean,
        ) => Promise<void>;

        type TxtResult = import("../modules/dns.mjs.js").DnsTxtResult;
        const txt: (name: string) => Promise<TxtResult>;
    }
}

namespace Libunbound {
    interface Request {
        callId: number,
        method: string,
    }
    interface LoadRequest extends Request {
        method: "load",
        path: string,
    }
    interface ResolveRequest extends Request {
        method: "resolve",
        name: string,
        rrtype: number,
    }
    interface UpdateCtxRequest extends Request {
        method: "update_ctx",
        getNameserversFromOS: boolean,
        nameservers: string[],
        trustAnchors: string[],
        conf?: string | undefined,
        debuglevel?: number | undefined,
    }
    type RequestMessages = LoadRequest | ResolveRequest | UpdateCtxRequest;
    interface WorkerRequest extends MessageEvent {
        data: RequestMessages;
    }

    interface Log {
        type: "log";
        subType: string;
        message: string;
    }
    interface Response {
        type: string;
        callId: number;
    }
    interface Result extends Response {
        type: "result";
        result: ub_result | undefined;
    }
    interface Exception extends Response {
        type: "error";
        subType: string;
        message: string;
        stack: string;
    }
    type ResponseMessages = Log | Result | Exception;;
    interface WorkerResponse extends MessageEvent {
        data: ResponseMessages;
    }

    interface LibunboundWorker extends Worker {
        onmessage: (this: Worker, ev: WorkerResponse) => any;
        postMessage(message: RequestMessages, transfer?: any[]): void;
    }
}

////////////////////////////////////////////////////////////////////////////////
//// For libunboundWorker.js

interface ub_ctx_struct extends ctypes.StructTypeI {
    readonly ptr: ctypes.PointerTypeI<ub_ctx_struct>;

    readonly name: "ub_ctx";
}

interface ub_result_struct extends ctypes.StructTypeI {
    readonly ptr: ctypes.PointerTypeI<ub_result_struct>;
    readonly _underlyingType: ub_result_data;

    readonly name: "ub_result";
}
interface ub_result_data extends ctypes.CData {
    qname: ctypes.CDataPointerType<typeof ctypes.char>;
    qtype: number;
    qclass: number;
    data: ctypes.CDataPointerType<typeof ctypes.char.ptr>;
    len: ctypes.CDataPointerType<typeof ctypes.int>;
    canonname: ctypes.CDataPointerType<typeof ctypes.char>;
    rcode: number;
    answer_packet: ctypes.CDataPointerType<typeof ctypes.void_t>;
    answer_len: number;
    havedata: number;
    nxdomain: number;
    secure: number;
    bogus: number;
    why_bogus: ctypes.CDataPointerType<typeof ctypes.char>;
    ttl: number;
}
