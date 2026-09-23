/** Base64 <-> bytes, working in both Node (tests, build) and the browser (bundle). */
export class Base64
{
    public static Encode(bytes: Uint8Array): string
    {
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
        return btoa(bin);
    }

    public static Decode(base64: string): Uint8Array
    {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }
}
