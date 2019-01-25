import { format } from 'url';
import { resolve } from 'path';
import _ from 'lodash';
import Boom from 'boom';
import Hapi from 'hapi';
import getDefaultRoute from './get_default_route';
import versionCheckMixin from './version_check';
import { handleShortUrlError } from './short_url_error';
import { shortUrlAssertValid } from './short_url_assert_valid';
import shortUrlLookupProvider from './short_url_lookup';
import setupConnectionMixin from './setup_connection';
import registerHapiPluginsMixin from './register_hapi_plugins';
import xsrfMixin from './xsrf';
import request2 from 'superagent';

module.exports = async function (kbnServer, server, config) {
  server = kbnServer.server = new Hapi.Server();

  const shortUrlLookup = shortUrlLookupProvider(server);
  await kbnServer.mixin(setupConnectionMixin);
  await kbnServer.mixin(registerHapiPluginsMixin);

  // provide a simple way to expose static directories
  server.decorate('server', 'exposeStaticDir', function (routePath, dirPath) {
    this.route({
      path: routePath,
      method: 'GET',
      handler: {
        directory: {
          path: dirPath,
          listing: false,
          lookupCompressed: true
        }
      },
      config: { auth: false }
    });
  });

  // provide a simple way to expose static files
  server.decorate('server', 'exposeStaticFile', function (routePath, filePath) {
    this.route({
      path: routePath,
      method: 'GET',
      handler: {
        file: filePath
      },
      config: { auth: false }
    });
  });

  // helper for creating view managers for servers
  server.decorate('server', 'setupViews', function (path, engines) {
    this.views({
      path: path,
      isCached: config.get('optimize.viewCaching'),
      engines: _.assign({ jade: require('jade') }, engines || {})
    });
  });

  server.decorate('server', 'redirectToSlash', function (route) {
    this.route({
      path: route,
      method: 'GET',
      handler: function (req, reply) {
        return reply.redirect(format({
          search: req.url.search,
          pathname: req.url.pathname + '/',
        }));
      }
    });
  });

  // attach the app name to the server, so we can be sure we are actually talking to kibana
  server.ext('onPreResponse', function (req, reply) {
    const response = req.response;

    const customHeaders = {
      ...config.get('server.customResponseHeaders'),
      'kbn-name': kbnServer.name,
      'kbn-version': kbnServer.version,
    };

    if (response.isBoom) {
      response.output.headers = {
        ...response.output.headers,
        ...customHeaders
      };
    } else {
      Object.keys(customHeaders).forEach(name => {
        response.header(name, customHeaders[name]);
      });
    }

    return reply.continue();
  });

  server.route({
    path: '/',
    method: 'GET',
    handler: function (req, reply) {
      return reply.view('root_redirect', {
        hashRoute: `${config.get('server.basePath')}/app/kibana`,
        defaultRoute: getDefaultRoute(kbnServer),
      });
    }
  });

  server.route({
    method: 'GET',
    path: '/{p*}',
    handler: function (req, reply) {
      const path = req.path;
      if (path === '/' || path.charAt(path.length - 1) !== '/') {
        return reply(Boom.notFound());
      }
      const pathPrefix = config.get('server.basePath') ? `${config.get('server.basePath')}/` : '';
      return reply.redirect(format({
        search: req.url.search,
        pathname: pathPrefix + path.slice(0, -1),
      }))
      .permanent(true);
    }
  });

  server.route({
    method: 'GET',
    path: '/goto/{urlId}',
    handler: async function (request, reply) {
      try {
        const url = await shortUrlLookup.getUrl(request.params.urlId, request);
        shortUrlAssertValid(url);

        const uiSettings = request.getUiSettingsService();
        const stateStoreInSessionStorage = await uiSettings.get('state:storeInSessionStorage');
        if (!stateStoreInSessionStorage) {
          reply().redirect(config.get('server.basePath') + url);
          return;
        }

        const app = kbnServer.uiExports.apps.byId.stateSessionStorageRedirect;
        reply.renderApp(app, {
          redirectUrl: url,
        });
      } catch (err) {
        reply(handleShortUrlError(err));
      }
    }
  });

  server.route({
    method: 'POST',
    path: '/shorten',
    handler: async function (request, reply) {
      try {
        shortUrlAssertValid(request.payload.url);
        const urlId = await shortUrlLookup.generateUrlId(request.payload.url, request);
        reply(urlId);
      } catch (err) {
        reply(handleShortUrlError(err));
      }
    }
  });

  // Expose static assets (fonts, favicons).
  server.exposeStaticDir('/ui/fonts/{path*}', resolve(__dirname, '../../ui/public/assets/fonts'));
  server.exposeStaticDir('/ui/favicons/{path*}', resolve(__dirname, '../../ui/public/assets/favicons'));

  kbnServer.mixin(versionCheckMixin);

  //add by matthew
  // get event list
  // secondary development
  function response(err, data, reply) {
    if (err) {
      reply(err);
    } else {
      reply(data.body);
    }
  }


  server.route({
    method: 'GET',
    path: '/event/list',
    handler: async function (request, reply) {
    request2.get(config.get('bdsa.eventList'))
      .send(request.payload)
      .set('Cookie', 'token=' + request.state.token)
      .end(function (err, data) {
        console.log("get event lists with restUri : " + config.get("bdsa.eventList"));
        //console.log(data);
        response(err, data, reply);
      });
    }
  });

  server.route({
    method: 'PUT',
    path: '/event/{eventId}',
    handler: async function (request, reply) {
    request2.put(config.get('bdsa.eventPut'))
      .send(request.payload)
      .set('Cookie', 'token=' + request.state.token)
      .end(function (err, data) {
        console.log("get event lists with restUri : " + config.get("bdsa.eventPut"));
        //console.log(data);
        response(err, data, reply);
      });
    }
  });

  server.route({
    method: 'POST',
    path: '/event',
    handler: async function (request, reply) {
    request2.post(config.get('bdsa.eventAdd'))
      .send(request.payload)
      .set('Cookie', 'token=' + request.state.token)
      .end(function (err, data) {
        console.log("get event lists with restUri : " + config.get("bdsa.eventAdd"));
        //console.log(data);
        response(err, data, reply);
      });
    }
  });
  return kbnServer.mixin(xsrfMixin);
};
