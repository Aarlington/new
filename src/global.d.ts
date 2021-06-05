// buffer-layout is oldschool JS without an @types/buffer-layout
// TS ambient typedef. So we fill in the missing bits here.
declare module 'buffer-layout' {
    export class Layout {
        span: number
    }
    export class Blob extends Layout {}
    export function blob(length: number, property: string): Blob

    export class Struct extends Layout {
        decode: (b: any, offset?: number) => any
    }
    export function struct(fields: any, property?: string, decodePrefixes?: any): Struct

    export class UInt extends Layout{}
    export function u8(property: string): UInt
}

// import with this line: import Wallet from "@project-serum/sol-wallet-adapter"
declare module '@project-serum/sol-wallet-adapter' {
    export class Wallet {
        constructor(uri: string, clusterApiUrl: string)
        public on(cbName: string, cb: any): any
        public connect(): any
    }

    export default Wallet
}
