import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'../backend/wwwroot',emptyOutDir:true},server:{proxy:{'/api':'http://127.0.0.1:3220'}}});
