// The WHATWG URL global exists in browsers, workerd and Node, but not in the ES lib, and this
// package deliberately loads neither DOM nor Node types. Declare just what shared uses.
// Consumers compile shared's sources with their own libs, where the full URL type applies.

interface URL {
  readonly hostname: string;
  readonly password: string;
  readonly protocol: string;
  readonly username: string;
}

declare var URL: {
  prototype: URL;
  new (url: string, base?: string): URL;
  canParse(url: string, base?: string): boolean;
};
