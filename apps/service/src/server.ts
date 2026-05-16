import { createServiceApp } from './app';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const app = createServiceApp();

await app.listen({ port, host });
console.log(`Color Wheel service listening on http://${host}:${port}`);
