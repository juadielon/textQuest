import './style.css';
import { renderStartScreen } from './start-screen';

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  renderStartScreen(app);
}
