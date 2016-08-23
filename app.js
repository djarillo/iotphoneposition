/*******************************************************************************
 * Copyright (c) 2014 IBM Corp.
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * and Eclipse Distribution License v1.0 which accompany this distribution.
 *
 * The Eclipse Public License is available at
 *   http://www.eclipse.org/legal/epl-v10.html
 * and the Eclipse Distribution License is available at
 *   http://www.eclipse.org/org/documents/edl-v10.php.
 *
 * Contributors:
 *   Bryan Boyd - Initial implementation
 *******************************************************************************/

var http = require('http');
var express = require('express'),
    path = require('path'),
    http = require('http'),
    https = require('https');
var app = express();
var Cloudant = require('cloudant');
var vcapServices;
var env;

if (process.env.VCAP_SERVICES) {
	env = JSON.parse(process.env.VCAP_SERVICES);
} else {
    // LOCAL environment
    var fs = require('fs');
    env = JSON.parse(fs.readFileSync('./iotphoneposition_VCAP_Services.json', 'utf8'));
}

if (env["cloudantNoSQLDB"])
{
    db_props = env['cloudantNoSQLDB'][0]['credentials'];
    // console.log(db_props);
}
else {
    console.log('You must bind the Cloudant DB to this application');
}

if (env["iotf-service"])
{
    iot_props = env['iotf-service'][0]['credentials'];
}
else
{
    console.log('You must bind the Internet of Things serviºce to this application');
}

var appInfo = JSON.parse(process.env.VCAP_APPLICATION || "{}");

var iot_server = iot_props["mqtt_host"];
var iot_org = iot_props["org"];
var iot_port = iot_props["mqtt_u_port"];
var iot_username = "use-token-auth";

var device_type = "iotphoneACN";

// all environments
app.set('port', process.env.PORT || 3001);
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

var device_credentials = null;
Cloudant({account:db_props.username, password:db_props.password}, function(err, cloudant) {
	console.log('Connected to Cloudant')

	cloudant.db.list(function(err, all_dbs) {
		if (all_dbs.length == 0) {
			// first time -- need to create the iotzone-devices database
			cloudant.db.create('device_credentials', function() {
				device_credentials = cloudant.use('device_credentials');
				console.log("created DB device_credentials");
			});
		} else {
			console.log("found DB device_credentials");
			device_credentials = cloudant.use('device_credentials');
		}
	})
})

app.get('/credentials/:deviceId', function(req, res) {
	var deviceId = req.params.deviceId;
	var token = getUserCredentials(deviceId, (function(_req, _res) {
		return function(json) {
			_res.json(json);
		}
	})(req, res));
});

function getUserCredentials(deviceId, callback) {
	// check to see if this device exists in the DB
	device_credentials.get(deviceId, function(err, body) {
		if (!err) {
			console.log("Found doc: ", body, body.token);
			callback({ deviceType: device_type, deviceId: deviceId, token: body.token, org: iot_org });
		} else {
			// register with IoT Foundation, return credentials
            console.log("NOT Found doc... Creating DOC");
			// register device type
			var typeData = JSON.stringify({id:"iotphoneACN"});
			var typeOpts = {
				host: iot_props.org + '.internetofthings.ibmcloud.com',
				port: 443,
				method: 'POST',
				headers: {
					"content-type" : "application/json"
				},
				path: 'api/v0002/device/types',
				auth: iot_props.apiKey + ':' + iot_props.apiToken
			};
			// var deviceData = JSON.stringify({deviceId:deviceId,authToken:deviceId});
            var deviceData = JSON.stringify({deviceId:deviceId});
            // console.log('**Device DATA -->'+deviceData);
			var deviceOpts = {
				host: iot_props.org + '.internetofthings.ibmcloud.com',
				port: 443,
				method: 'POST',
				headers: {
					"content-type" : "application/json"
				},
				path: 'api/v0002/device/types/iotphoneACN/devices/',
				auth: iot_props.apiKey + ':' + iot_props.apiToken
			};

			var deviceType_req = https.request(typeOpts, function(deviceType_res) {
				try {
					var str = '';
					deviceType_res.on('data', function(chunk) {
						str += chunk;
					});
					deviceType_res.on('end', function() {

				    // register device
                        var device_req = https.request(deviceOpts, function(device_res) {
							var str = '';
							device_res.on('data', function(chunk) {
								str += chunk;
							});

							device_res.on('end', function() {
								try {
									var creds = JSON.parse(str);

									if (creds.deviceId) {
										device_credentials.insert({ token: creds.authToken }, creds.deviceId, function(err, body) {
											if (!err) {
												callback({ deviceType: creds.typeId, deviceId: creds.deviceId, token: creds.authToken, org: iot_org });
											} else {
                                                console.log("******Error en INSERT");
												callback({ error: err.code });
											}
										});
									} else {
                                        console.log("***NOT DeviceID");
										callback({ error: err.code });
									}
								} catch (e) { console.log(e.stack); callback({ error: 500 }); }
							});
						});
						device_req.write(deviceData);
						device_req.end();
					});
				} catch (e) { console.log(e); }
			}).on('error', function(e) { console.log ("got error, " + e); });
			deviceType_req.write(typeData);
			deviceType_req.end();
		}
	});
}

http.createServer(app).listen(app.get('port'), function(){
	console.log('Express server listening on port ' + app.get('port'));
});
