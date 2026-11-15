// Phase H Step 8: LOCAL test fixture only. Runs in the app container's network namespace
// (compose network_mode "service:app") and forwards 127.0.0.1:<port> to the same port on the
// host (host.docker.internal), so the fork E2E's loopback-only services (the local validator's
// RPC proxies, the Jupiter stand-in, the notification sink, the local Postgres WebSocket proxy)
// are reachable at the SAME loopback URLs the env schema requires for a fork run.
// Env: BRIDGE_PORTS (comma-separated), BRIDGE_TARGET (host.docker.internal).
import net from "node:net";

const target = process.env.BRIDGE_TARGET ?? "host.docker.internal";
const ports = (process.env.BRIDGE_PORTS ?? "")
  .split(",")
  .map((p) => Number(p.trim()))
  .filter((p) => Number.isInteger(p) && p > 0 && p !== 3000);
if (!ports.length) {
  process.stderr.write("loopback-bridge: BRIDGE_PORTS is empty\n");
  process.exit(1);
}
for (const port of ports) {
  net
    .createServer((client) => {
      const remote = net.connect(port, target);
      client.pipe(remote).pipe(client);
      const close = () => {
        client.destroy();
        remote.destroy();
      };
      client.on("error", close);
      remote.on("error", close);
    })
    .listen(port, "127.0.0.1");
}
process.stdout.write(`loopback-bridge: ${ports.join(",")} -> ${target}\n`);
process.once("SIGTERM", () => process.exit(0));
