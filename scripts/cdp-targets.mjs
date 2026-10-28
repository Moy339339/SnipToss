// Shared by cdp-*.mjs: lists the pages on the WebView2 debugging port.
// When another program holds this port on 127.0.0.1, WebView2 listens on IPv6 [::1] instead (when the system's dynamic port range starts at 1024,
// another program's outgoing connections can be assigned 9333, and connecting to 127.0.0.1 then fails with ECONNREFUSED). So try 127.0.0.1 first, then [::1]

export async function cdpTargets(port) {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    return await (await fetch(`http://[::1]:${port}/json`)).json();
  }
}
