/* eslint-disable simple-import-sort/imports -- register-aliases precisa rodar antes de qualquer import com alias "@/" */
import './register-aliases';

import { createServer } from 'http';

import { createApp } from './app';
import { API_PORT, NODE_ENV } from './utils/var';

const httpServer = createServer(createApp());

function onListen() {
  console.log(`deManage API running on ${API_PORT}`);
}

if (NODE_ENV === 'production') {
  httpServer.listen(Number(API_PORT), '::', onListen);
} else {
  httpServer.listen(API_PORT, onListen);
}
