let server = "fakebook.khoury.northeastern.edu"

let port = 443;

const tls = require('tls');

let currentSocket = null;

let mapOfCookies = new Map();

let username = null;
let password = null;

async function connectToTLS() {
    return new Promise((resolve, reject) => {
        const newSocket = tls.connect({ host: server, port: port, servername: server }, () => {
            resolve(newSocket);
        });
        newSocket.on("error", (error) => {
            reject(error);
        });
    });
}

function getParamsHelper() {
    const argToParse = process.argv.slice(2);

    let setServer = null;
    let setPort = null;

    for(let i = 0; i < argToParse.length; i++) {
        if(argToParse[i] == '-s') {
            setServer = argToParse[i + 1];
        }
        else if(argToParse[i] == '-p') {
            setPort = argToParse[i + 1];
        }
    }

    let username = null;
    let password = null;

    password = argToParse[argToParse.length - 1];
    username = argToParse[argToParse.length - 2];

    return {
        server: setServer || server,
        port: Number(setPort) || port,
        username: username,
        password: password
    }
}

function buildGetRequestHelper(path, body) {
    
    let request = "";
        request += `GET ${path} HTTP/1.1`;
        request += "\r\n";
        if(port !== 443) {
            request += `Host: ${server}:${port}`;
        }
        else {
            request += `Host: ${server}`;
        }
        request += "\r\n";

        let cookieList = [];

        const cookieNames = Array.from(mapOfCookies.keys());
        for(let i = 0; i < cookieNames.length; i++) {
            cookieList.push(`${cookieNames[i]}=${mapOfCookies.get(cookieNames[i])}`);
        }

        let cookiesFormatted = cookieList.join("; ");

        if(cookieList.length > 0) {
            request += `Cookie: ${cookiesFormatted}`;
            request += "\r\n";
        }
        request += "\r\n";
        return request;
}

function buildPostRequestHelper(path, body) {
    let request = "";
    request += `POST ${path} HTTP/1.1`;
    request += "\r\n";
    if(port !== 443) {
        request += `Host: ${server}:${port}`;
    }
    else {
        request += `Host: ${server}`;
    }
    request += "\r\n";

    let cookieList = [];
    const cookieNames = Array.from(mapOfCookies.keys());
    for(let i = 0; i < cookieNames.length; i++) {
        cookieList.push(`${cookieNames[i]}=${mapOfCookies.get(cookieNames[i])}`);
    }
    let cookiesFormatted = cookieList.join("; ");
    if(cookieList.length > 0) {
        request += `Cookie: ${cookiesFormatted}`;
        request += "\r\n";
    }
    request += "Content-Type: application/x-www-form-urlencoded";
    request += "\r\n";
    request += `Content-Length: ${Buffer.byteLength(body)}`;
    request += "\r\n";
    request += `Origin: https://${server}`;
    request += "\r\n";
    request += `Referer: https://${server}/accounts/login/?next=/fakebook/`;
    request += "\r\n";
    request += "\r\n";
    request += body;
    return request;
}

function transferEncodingParser(allData, start) {

    const dataChunkArray = allData.slice(start).toString("latin1").split("\r\n");

    //check if the last byte line is 0 if not then return null and wait more 
    const lastByteLine = dataChunkArray[dataChunkArray.length - 3];
    if(lastByteLine !== "0") {
        return null;
    }
    let data = "";
    for(let i = 0; i < dataChunkArray.length - 3; i++) {
        if(i % 2 == 0) {
            continue;
        }
        else {
            data += dataChunkArray[i];
        }
    }
    return Buffer.from(data, "latin1");
}

function responseCheckerHelper(allData) {

    let headerPresent = false;
    if(allData.indexOf("\r\n\r\n") !== -1) {
        headerPresent = true;
    }
    if(!headerPresent) {
        return null;
    }



    const allHeaders = allData.slice(0, allData.indexOf("\r\n\r\n"));
    const allHeaderArray = allHeaders.toString("latin1").split("\r\n");

    let statusNumber = Number(allHeaderArray[0].split(" ")[1]);
    const headerMap = new Map();
    const cookieMap = new Map();
    let cookieKey = null;
    let cookieValue = null;
    
    for(let i = 1; i < allHeaderArray.length; i++) {
        const colonIndex = allHeaderArray[i].indexOf(":");
        const headerName = allHeaderArray[i].slice(0, colonIndex).trim().toLowerCase();
        const headerValue = allHeaderArray[i].slice(colonIndex + 1).trim();

        if(headerName === "set-cookie") {
            const cookiePair = headerValue.split(";")[0];
            cookieKey = cookiePair.slice(0, cookiePair.indexOf("="));
            cookieValue = cookiePair.slice(cookiePair.indexOf("=") + 1);
            cookieMap.set(cookieKey, cookieValue);
        }
        else {
            headerMap.set(headerName, headerValue);
        }
    }

    const bodyStartInx = allData.indexOf("\r\n\r\n") + 4;
    const contentLengthOrNot = headerMap.has("content-length");
    if(contentLengthOrNot) {
        const totalDataSize = Number(headerMap.get("content-length"));
        if(bodyStartInx + totalDataSize > allData.length) {
            return null;
        }
        const body = allData.slice(bodyStartInx, bodyStartInx + totalDataSize);
        return {
            statusCode: statusNumber,
            headers: headerMap,
            cookies: cookieMap,
            body: body
        }
    }
    else if(headerMap.get("transfer-encoding") === "chunked") {
        const body = transferEncodingParser(allData, bodyStartInx);
        if(body === null) {
            return null;
        }
        return {
            statusCode: statusNumber,
            headers: headerMap,
            cookies: cookieMap,
            body: body
        }
    }
    else {
        return {
            statusCode: statusNumber,
            headers: headerMap,
            cookies: cookieMap,
            body: Buffer.alloc(0)
        }
    }

}


async function sendRequestHelper(method, path, body) {
    return new Promise((resolve, reject) => {
        let allData = Buffer.alloc(0);

        function updateData(dataChunk) {
            allData = Buffer.concat([allData, dataChunk]);
            const response = responseCheckerHelper(allData);
            if(response !== null) {
                currentSocket.off("data", updateData);
                currentSocket.off("close", closeSocket);
                resolve(response);
            }
        }

        function closeSocket() {
            currentSocket.off("data", updateData);
            currentSocket.off("close", closeSocket);
            reject(new Error("connection closed"));
        }


        currentSocket.on("data", updateData);
        currentSocket.on("close", closeSocket);
        let request;
        if(method === "GET") {
            request = buildGetRequestHelper(path, body);
    
        }
        else if(method === "POST") {
            request = buildPostRequestHelper(path, body);
        }
        currentSocket.write(request);
    });
    
}

function saveCookiesHelper(setCookies) {
    const cookieNames = Array.from(setCookies.keys());
    for(let i = 0; i < cookieNames.length; i++) {
        mapOfCookies.set(cookieNames[i], setCookies.get(cookieNames[i]));
    }
}

async function loginpageInfoHelper() {
    const keepLooping = true;

    let currentPath = "/accounts/login/?next=/fakebook/";
    let currentMethod = "GET";
    while(keepLooping) {
        let pageInfo;

        try {
            pageInfo = await sendRequestHelper(currentMethod, currentPath, null);

        } catch (error) {
            continue;
        }

        //update the map of cookies
        saveCookiesHelper(pageInfo.cookies);
        console.log(pageInfo.statusCode, pageInfo.headers);

        if(pageInfo.statusCode === 200) {
            return {
                pageInfo: pageInfo.body.toString("utf8"), 
                pagePath: currentPath
            };
        }

        else if(pageInfo.statusCode === 302) {
            const newLocation = pageInfo.headers.get("location");

            const newUrl = new URL(newLocation, `https://${server}:${port}${currentPath}`);
            currentPath = newUrl.pathname + newUrl.search;
            currentMethod = "GET";
        }
        else if(pageInfo.statusCode === 503) {
            continue;
        }
        else if(pageInfo.statusCode === 403 || pageInfo.statusCode === 404) {
            return null;
        }

    }
}

async function sendGetLoginPage() {
    const loginpageInfo = await loginpageInfoHelper();
    return loginpageInfo;

}


async function main() {
    const argsFromCommand = getParamsHelper();
    server = argsFromCommand.server;
    port = argsFromCommand.port;

    currentSocket = await connectToTLS();

    //send GET to login page
    const loginPage = await sendGetLoginPage();
    console.log(loginPage.pageInfo);
    console.log(mapOfCookies);
}

main();