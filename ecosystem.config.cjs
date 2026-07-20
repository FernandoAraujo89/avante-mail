// Processos de produção no VPS (PM2): app Next.js + worker de envio.
module.exports = {
  apps: [
    {
      name: "avante-mail",
      cwd: "/root/avante-mail",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "avante-worker",
      cwd: "/root/avante-mail",
      script: "node_modules/.bin/tsx",
      args: "worker/email-worker.ts",
      max_memory_restart: "512M",
    },
  ],
};
