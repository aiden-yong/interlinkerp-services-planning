import type { App } from '../app';
import { Router } from '../http/router';
import * as cron from './cron';
import * as employees from './employees';
import * as health from './health';
import * as holidays from './holidays';
import * as managers from './managers';
import * as me from './me';
import * as roles from './roles';
import * as settings from './settings';
import * as timeOff from './timeOff';

/** Every route module. Later tasks add theirs to this list. */
const MODULES: { register(r: Router, app: App): void }[] = [health, me, cron, settings, roles, employees, timeOff, holidays, managers];

export function buildRouter(app: App): Router {
  const router = new Router();
  for (const module of MODULES) module.register(router, app);
  return router;
}
