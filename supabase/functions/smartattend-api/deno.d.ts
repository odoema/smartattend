// Types for the Supabase Edge Runtime surface this function uses, so `tsc` can
// check it without Deno installed. Declarations only - nothing runs from here.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
declare module "npm:postgres@3.4.4" { const postgres: any; export default postgres; }
declare module "npm:@simplewebauthn/server@10.0.1" {
  export const generateRegistrationOptions: any;
  export const verifyRegistrationResponse: any;
  export const generateAuthenticationOptions: any;
  export const verifyAuthenticationResponse: any;
}
declare module "npm:@simplewebauthn/server@10.0.1/helpers" {
  export const isoBase64URL: { fromBuffer(b: Uint8Array): string; toBuffer(s: string): Uint8Array };
}