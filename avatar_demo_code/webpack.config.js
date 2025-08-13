
/* 
Copyright 2024-2024 Amazon.com, Inc. or its affiliates.  All Rights Reserved.

You may not use this file except in compliance with the terms and conditions set forth in the accompanying LICENSE.TXT file.

THESE MATERIALS ARE PROVIDED ON AN "AS IS" BASIS. AMAZON SPECIFICALLY DISCLAIMS, WITH RESPECT TO THESE MATERIALS, ALL WARRANTIES, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
*/

const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require('webpack');

/**
 * We're packing 5 different outputs:
 *  + A browser bundle that the web app game loads
 *  + A dev version of the web app, with extra code
 *  + A lambda bundle that is the skill backend
 *  + A lambda bundle, the "service" that provides authenticated AWS to the web app
 *  + A lambda bundle that serves as our openID JSON Web Token (JWT) host
 */

const mode = "development";
const tsRule = {
  test: /\.tsx?$/,
  use: {
    loader: "ts-loader",
    options: {
      /**
       * transpileOnly disables type checking at pack time, which 
       * significantly increases packing speed at the cost of one more
       * layer of type safety checking. Toggle as you see fit.
       */
      transpileOnly: false
    }
  },
  exclude: /node_modules/,
};

const cssRule = {
  test: /\.css$/,
  use: ["style-loader", "css-loader"],
}

const watchOptions = {
  aggregateTimeout: 500,
  ignored: /node_modules/,
};

const resolveOptions = {
  extensions: [".ts", ".js", ".tsx"],
  fallback: { 'process/browser': require.resolve('process/browser'), }
};

const webAppTargetDirectory = path.join(__dirname, "build", "webapp");

const copyWebappAssetsPlugin = new CopyPlugin({
  patterns: [{
    from: path.join(__dirname, "modules", "webapp-assets"),
    to: webAppTargetDirectory
  }],
});

const webAppProd = {
  mode,
  entry: path.join(__dirname, "modules", "webapp-code", "main-prod.ts"),
  output: {
    path: webAppTargetDirectory,
    filename: "bundle.js",
  },
  module: { rules: [tsRule, cssRule] },
  resolve: resolveOptions,
  plugins: [
    copyWebappAssetsPlugin,
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"], // Provide Buffer globally
      process: "process/browser", // Provide process globally
    }),
    new webpack.ProvidePlugin({
      "React": "react",
      "ReactDOM": "react-dom",
    }),
  ],
  watchOptions,
};

const webAppDev = {
  mode,
  entry: path.join(__dirname, "modules", "webapp-code", "main-dev.ts"),
  output: {
    path: webAppTargetDirectory,
    filename: "bundle-dev.js",
  },
  module: { rules: [tsRule, cssRule] },
  resolve: resolveOptions,
  watchOptions,
  plugins: [
    copyWebappAssetsPlugin,
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"], // Provide Buffer globally
      process: "process/browser", // Provide process globally
    }),
    new webpack.ProvidePlugin({
      "React": "react",
      "ReactDOM": "react-dom",
    }),
  ],
};

function packLambda(entrypointFile, destinationPath) {
  return {
    mode,
    entry: entrypointFile,
    target: "node",
    output: {
      path: destinationPath,
      filename: "index.js",
      library: {
        type: "commonjs-module",
      },
    },
    module: { rules: [tsRule] },
    resolve: resolveOptions,
    externals: [/aws-sdk/i],
    watchOptions,
  };
}

const openIDEndpoint = packLambda(
  path.join(__dirname, "modules", "endpoint-openid", "index.ts"),
  path.join(__dirname, "build", "endpoint-openid")
);

const servicesEndpoint = packLambda(
  path.join(__dirname, "modules", "endpoint-services", "index.ts"),
  path.join(__dirname, "build", "endpoint-services")
);

const skillEndpoint = packLambda(
  path.join(__dirname, "modules", "endpoint-skill", "index.ts"),
  path.join(__dirname, "build", "endpoint-skill")
);


function packAgentWebApp(name) {
  const sourceDir = path.join(__dirname, "modules", "agents", name);
  const targetDir = path.join(webAppTargetDirectory, "agents", name);
  return {
    mode,
    entry: path.join(sourceDir, "main.ts"),
    output: {
      path: targetDir,
      filename: "main.js",
    },
    module: { rules: [tsRule, cssRule] },
    resolve: resolveOptions,
    watchOptions,
    plugins: [
      new CopyPlugin({
        patterns: [{
          from: sourceDir, to: targetDir, filter: (fp) => {
            const ext = path.extname(fp);
            return ['.html', '.png', '.jpg', '.jpeg', '.mp3'].indexOf(ext) >= 0;
          }
        }],
      }),
      new webpack.ProvidePlugin({
        "React": "react",
        "ReactDOM": "react-dom",
      }),
    ],
  };

}

const apps = {
  Avatars: packAgentWebApp('Avatars')
}

module.exports = function (env) {
  console.log(env);
  try {
    const names = env['apps'].split(',');
    const filteredApps = [];
    for (name of names) {
      if ( name === 'webAppDev') {
        filteredApps.push(webAppDev);
      } else if (name === 'webAppProd') {
        filteredApps.push(webAppDev);
      } else if (name === 'servicesEndpoint') {
        filteredApps.push(servicesEndpoint);
      } else {
        filteredApps.push(apps[name]);
      }
    }
    return filteredApps;
  } catch (err) {
    console.error(err);
    return [webAppDev]
  }
}

//module.exports = [webAppDev, webAppProd, servicesEndpoint, EverydayLingo, STEMBuilder, Thumbtack, DailyHoroscope, Labs, Indeed, IndeedInterview, Volley, Daniel]
