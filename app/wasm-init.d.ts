declare module "*.wasm?init" {
  const initialize: (imports?: WebAssembly.Imports) => Promise<WebAssembly.Instance>;
  export default initialize;
}
