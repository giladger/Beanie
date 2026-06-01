import { BeanieApp } from './app';
import './styles.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Beanie root element was not found');
}

new BeanieApp(root).start();
