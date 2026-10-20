import type { App } from '../app';
import { Router } from '../http/router';
import * as cron from './cron';
import * as devIdentity from './devIdentity';
import * as employees from './employees';
import * as health from './health';
import * as holidays from './holidays';
import * as managers from './managers';
import * as me from './me';
import * as myShifts from './myShifts';
import * as notifications from './notifications';
import * as openShifts from './openShifts';
import * as publications from './publications';
import * as roles from './roles';
import * as schedule from './schedule';
import * as settings from './settings';
import * as shifts from './shifts';
import * as templates from './templates';
import * as timeOff from './timeOff';
import * as weekCopies from './weekCopies';

/** Every route module. Later tasks add theirs to this list. */
const MODULES: { register(r: Router, app: App): void }[] = [health, me, cron, settings, roles, employees, timeOff, holidays, managers, shifts, templates, schedule, publications, myShifts, openShifts, notifications, devIdentity, weekCopies];

export function buildRouter(app: App): Router {
  const router = new Router();
  for (const module of MODULES) module.register(router, app);
  return router;
}
