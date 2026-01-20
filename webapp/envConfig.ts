import { loadEnvConfig } from '@next/env';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..');

loadEnvConfig(projectRoot);
