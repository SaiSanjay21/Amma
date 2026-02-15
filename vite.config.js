import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    plugins: [
        basicSsl(),    // enables HTTPS with a self-signed certificate
    ],
    server: {
        host: '0.0.0.0',   // accessible from other devices on the network
        port: 5174,
    },
    preview: {
        host: '0.0.0.0',
        port: 4173,
    },
});
