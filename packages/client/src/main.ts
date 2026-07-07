import { GameApp } from './GameApp.js';

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

new GameApp(container).start();
