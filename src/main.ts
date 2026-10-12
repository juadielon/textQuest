import './style.css';
import { renderPlaceholder } from './status';

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  renderPlaceholder(app);
}
