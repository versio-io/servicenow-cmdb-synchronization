/*
* Copyright (C) QMETHODS - Business & IT Consulting GmbH - All Rights Reserved
* The unauthorized use and reproduction of this file is strictly allowed :-)
*/

// SERVICE NOW CONFIGURATION
const SERVICE_NOW_URL = ""; // URL of your own ServiceNow instance (eg. "https://dev000000.service-now.com").
const SERVICE_NOW_USERNAME = ""; // the username to access your own ServiceNow instance.
const SERVICE_NOW_PASSWORD = ""; // the password to access your own ServiceNow instance.
const SERVICE_NOW_TABLE = "cmdb_ci_server"; // the name of the table where you want to import the data (eg. "cmdb_ci_server" for Servers table and "cmdb_ci_service" for Services). You can find the right table name using the REST API Explorer (look for "Table API" in the "now" namespace) in your ServiceNow instance.


// VERSIO.IO CONFIGURATION
const VERSIO_URL = "https://live.versio.io"; // URL of your Versio.io instance. The default one is "https://live.versio.io" and you should change it only if you have an on-premise Versio.io instance.
const VERSIO_ENVIRONMENT = ""; // the 10-charachters ID of your Versio.io environment. You can find it in the first line of the Dashboard tab.
const VERSIO_APITOKEN = ""; // to export your data from Versio.io you need to create an API token. Go to Environment settings -> Access management -> API tokens and create a new token with "CMDB viewer" rights.
const VERSIO_ENTITY = "host"; //the name of the instances group you want to export to ServiceNow (eg. "host" for Hosts and "service" for Services). You can find the right entity name using the "Instances viewer" tab and selecting the single group of entity you want to export. The string after "ens=" in the page's URL is the attribute you need.

// MAPPING CONFIGURATION
const MAPPING = "linux-host"; // use "linux-host", "windows-host" or "service" for the default mapping, otherwise you can define your own mapping here or you can extend the switch in the setMapping function (line 29).

// --------------------
// -----  SCRIPT  -----
// --------------------

const request = require('axios');

/** 
 * Set the appropriate mapping depending on the attribute given by the user.
 * @function setMapping
*/
async function setMapping() {
    if (typeof MAPPING !== 'object') {
        switch (MAPPING) {
            case 'linux-host': 
                mapping = {
                    name: ["displayName"],
                    manufacturer: ["system", "manufacturer"],
                    serial_number: ["system", "serialNumber"],
                    model_id: ["system", "version"],
                    os: ["technology", "Operating system", "product"],
                    os_version: ["technology", "Operating system", "version"],
                    cpu_manufacturer: ["hardware", "processor", "devices", 0, "manufacturer"],
                    cpu_count: ["hardware", "processor", "totalDevices"],
                    cpu_core_count: ["hardware", "processor", "devices", 0, "coreCount"],
                    ip_address: ["operatingSystem", "networkInterfaces", "vmbr0", "inet"],
                    mac_address: ["operatingSystem", "networkInterfaces", "vmbr0", "ether"]
                }
                break;
            case 'windows-host': 
                mapping = {
                    name: ["displayName"],
                    manufacturer: ["system", "manufacturer"],
                    serial_number: ["bios", "serialNumber"],
                    model_id: ["system", "model"],
                    os: ["technology", "Operating system", "product"],
                    os_version: ["technology", "Operating system", "version"],
                    cpu_manufacturer: ["hardware", "processor", "devices", 0, "manufacturer"],
                    cpu_count: ["hardware", "processor", "totalDevices"],
                    cpu_core_count: ["hardware", "processor", "devices", 0, "numberOfCores"]
                }
                break;
            case 'service':
                mapping = {
                    name: ["displayName"]
                }
                break;
            default:
                console.error(`There is no mapping defined for "${MAPPING}".`);
                process.exit(0);
        }
    }
}

/**
 * Create a new entity following the mapping instructions. This entity will be used to import the data in ServiceNow.
 * @function mapEntity
 * @param {Object} versioEntity - Entity retrieved from the Versio.io API.
 * @param {Object} mapping - Interface to map the object from Versio.io to ServiceNow.
 * @return {Object} ServiceNow entity.
*/ 
async function mapEntity(versioEntity, mapping) {
    let obj = Object.entries(mapping).reduce((prev, [keyName, valuePath]) => {
        prev[keyName] = valuePath.reduce((entityObject, pathKey) => entityObject[pathKey] || "", versioEntity.state);
        return prev;
    }, {});
    obj['asset_tag'] = versioEntity.instance.split('-')[1]; // split the Versio.io instance ID because it's too long for ServiceNow (max lenght = 40)
    return obj;
}

/** 
 * Retrieve all the entity IDs for the indicated instances group from Versio.io.
 * @function getVersioEntityIDs
 * @return {Array} List of the Versio.io entity IDs.
*/
async function getVersioEntityIDs() {
    let limit = 1000;
    let offset = 0;
    let length = 0;
    let result = [];
    do {
        let res = (await request(
            {
                'method': 'GET',
                'url': `${VERSIO_URL}/api-versio.db/1.0/${VERSIO_ENVIRONMENT}/${VERSIO_ENTITY}?offset=${offset}&limit=${limit}&utc=${Date.now()}`,
                'headers': {
                    'Accept': 'application/json',
                    'Authorization': `apiToken ${VERSIO_APITOKEN}`
                }
            }
        )).data;
        length = res.totalAvailableItems;
        result = result.concat(res.items);
        offset += limit;
    } while (offset < length)
    return result;
}

/** 
 * Create a new entity in the ServiceNow CMDB.
 * @function createServiceNowEntity
 * @param {string} entityID - ID of the Versio.io entity to export.
*/
async function createServiceNowEntity(entityID) {
    let cred = Buffer.from(`${SERVICE_NOW_USERNAME}:${SERVICE_NOW_PASSWORD}`).toString('base64');
    let entityName = entityID;

    try {

        //get the whole entity from Versio.io using the ID.
        let versioEntity = (await request(
            {
                'method': 'GET',
                'url': `${VERSIO_URL}/api-versio.db/1.0/${VERSIO_ENVIRONMENT}/${VERSIO_ENTITY}/${entityID}`,
                'headers': {
                    'Accept': 'application/json',
                    'Authorization': `apiToken ${VERSIO_APITOKEN}`
                }
            }
        )).data.items[0];

        // process the data only if the entity is not deleted.
        if (versioEntity.state) {
            let serviceNowEntity = await mapEntity(versioEntity, mapping);
            entityName = serviceNowEntity.name;

            // search for the entity in the ServiceNow table using the asset_tag value.
            if (serviceNowEntity.serial_number || !mapping.serial_number) {
                let serviceNowEntityId = (await request(
                    {
                        'method': 'GET',
                        'url': `${SERVICE_NOW_URL}/api/now/table/${SERVICE_NOW_TABLE}?sysparm_fields=sys_id&sysparm_query=asset_tag=${serviceNowEntity.asset_tag}`,
                        'headers': {
                            'Accept': 'application/json',
                            'Authorization': `Basic ${cred}`
                        }
                    }
                )).data.result;

                // if the entity already exists, update the instance instead of creating a new one.
                await request(
                    {
                        'method': serviceNowEntityId.length > 0 ? 'PUT' : 'POST',
                        'url': serviceNowEntityId.length > 0 ? `${SERVICE_NOW_URL}/api/now/table/${SERVICE_NOW_TABLE}/${serviceNowEntityId[0].sys_id}` : `${SERVICE_NOW_URL}/api/now/table/${SERVICE_NOW_TABLE}`,
                        'headers': {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'Authorization': `Basic ${cred}`
                        },
                        'data': JSON.stringify(serviceNowEntity)
                    }
                );
                console.log(`\t${count++}) ${entityName} ${serviceNowEntityId.length > 0 ? (updated++,"updated") : (imported++, "imported")};`);
            } else {
                console.warn(`\t${count++}) Cannot import ${entityName}: serial number not found at the given path;`);
                errors++;
            }
        } else {
            console.warn(`\t${count++}) Cannot import ${entityName}: entity deleted;`);
            errors++;
        }
    } catch (error) {
        console.error(`\t${count++}) Error while importing ${entityName}:`);
        if(error.response?.data?.error?.detail?.includes('uniqueness')) {
            console.error(`\t\tEntity with name "${entityName}" already exists in table "${SERVICE_NOW_TABLE}";`);
            duplicated++;
        } else {
            console.error(`\t\t${error};`);
            errors++;
        }
    }
}

let startTime = Date.now();

//#region check configuration values
let error = false;
if (!SERVICE_NOW_URL) {
    error = true;
    console.error("SERVICE_NOW_URL (line 2) attribute missing.");
}
if (!SERVICE_NOW_USERNAME) {
    error = true;
    console.error("SERVICE_NOW_USERNAME (line 3) attribute missing.");
}
if (!SERVICE_NOW_PASSWORD) {
    error = true;
    console.error("SERVICE_NOW_PASSWORD (line 4) attribute missing.");
}
if (!SERVICE_NOW_TABLE) {
    error = true;
    console.error("SERVICE_NOW_TABLE (line 5) attribute missing.");
}
if (!VERSIO_URL) {
    error = true;
    console.error("VERSIO_URL (line 9) attribute missing.");
}
if (!VERSIO_ENVIRONMENT) {
    error = true;
    console.error("VERSIO_ENVIRONMENT (line 10) attribute missing.");
}
if (!VERSIO_APITOKEN) {
    error = true;
    console.error("VERSIO_APITOKEN (line 11) attribute missing.");
}
if (!VERSIO_ENTITY) {
    error = true;
    console.error("VERSIO_ENTITY (line 12) attribute missing.");
}
if (!MAPPING) {
    error = true;
    console.error("MAPPING (line 15) attribute missing.");
}
//#endregion

let count = 1;
let imported = 0;
let updated = 0;
let duplicated = 0;
let errors = 0;
let mapping = MAPPING;

async function main() {
    if (!error) {
        try {
            setMapping();
            const entityIDs = await getVersioEntityIDs();
            console.log(`Importing ${entityIDs.length} entit${entityIDs.length !== 1 ? 'ies' : 'y'} in ServiceNow:`);
            for (const entityID of entityIDs) {
                await createServiceNowEntity(entityID);
            }
            let totalTime = Date.now() - startTime;
            let minutes = Math.trunc(totalTime / 60000) + '';
            let seconds = ((totalTime % 60000) / 1000) + '';
            console.log(`Operation finished in ${minutes.length === 1 ? '0' + minutes : minutes}:${seconds.split('.')[0].length === 1 ? '0' + seconds : seconds}:`);
            console.log(`\t${imported} imported, ${updated} updated, ${duplicated + errors} errors (${duplicated} duplicated, ${errors} others).`);
        } catch (error) {
            console.error("Error during the script execution:")
            console.error("\t" + error);
        }
    } else {
        console.error("Set all the required attributes and retry.");
        process.exit(0);
    }
}

main();
