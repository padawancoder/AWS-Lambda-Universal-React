import Express from 'express';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import favicon from 'serve-favicon';
import compression from 'compression';
import http from 'http';
import proxy from 'express-http-proxy';
import path from 'path';
import url from 'url';
import { match, createMemoryHistory } from 'react-router';

import config from './config';
import configureStore from './redux/configureStore';
import Html from './helpers/Html';
import getRoutes from './routes';
import waitAll from './sagas/waitAll';
import { Root } from 'containers';
import awsServerlessExpressMiddleware from 'aws-serverless-express/middleware';

const app = new Express();

// disable `X-Powered-By` HTTP header
app.disable('x-powered-by');

app.use(awsServerlessExpressMiddleware.eventContext());
app.use(compression());
//app.use(favicon(path.join(__dirname, '..', 'static', 'favicon.ico')));
app.use(Express.static(path.join(__dirname, '..', 'static')));

app.use((req, res) => {
  console.log(req);
  if (__DEVELOPMENT__) {
    webpackIsomorphicTools.refresh();
  }

  const memoryHistory = createMemoryHistory();
  const store = configureStore();
  const allRoutes = getRoutes(store);
  const assets = webpackIsomorphicTools.assets();
  const url = req.apiGateway ? req.apiGateway.event.pathParameters.pathName : req.url || "/";

  function hydrateOnClient() {
    const htmlComponent = <Html assets={assets} store={store} />;
    const renderedDomString = ReactDOMServer.renderToString(htmlComponent);
    res.send(`<!doctype html>\n ${renderedDomString}`);
  }

  if (__DISABLE_SSR__) {
    hydrateOnClient();
    return;
  }

  match({ routes: allRoutes, location: url }, (error, redirectLocation, renderProps) => {
    if (redirectLocation) {
      res.redirect(redirectLocation.pathname + redirectLocation.search);
    } else if (error) {
      console.error('ROUTER ERROR:', error);
      res.status(500);
      hydrateOnClient();
    } else if (renderProps) {
      const rootComponent = (<Root
        store={store}
        routes={allRoutes}
        history={memoryHistory}
        renderProps={renderProps}
        type="server"
      />);

      const preloaders = renderProps.components
        .filter((component) => component && component.preload)
        .map((component) => component.preload(renderProps.params, req))
        .reduce((result, preloader) => result.concat(preloader), []);

      const runTasks = store.runSaga(waitAll(preloaders));

      runTasks.done.then(() => {
        global.navigator = { userAgent: req.headers['user-agent'] };

        const htmlComponent = <Html assets={assets} component={rootComponent} store={store} />;
        const renderedDomString = ReactDOMServer.renderToString(htmlComponent);
        res.status(200).send(`<!doctype html>\n ${renderedDomString}`);
      }).catch((e) => {
        console.log(e.stack);
      });

      store.close();
    } else {
      res.status(404).send('Not found');
    }
  });
});

if (config.port) {
  app.listen(config.port, (err) => {
    if (err) {
      console.error(err);
    }
    console.info('==> 💻  Open http://%s:%s in a browser to view the app.', config.host, config.port);
  });
} else {
  console.error('==>     ERROR: No PORT environment variable has been specified');
}

export default app;