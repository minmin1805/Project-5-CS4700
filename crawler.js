const server = "fakebook.khoury.northeastern.edu"

const port = 443;

const tls = require('tls');

const currentSocket = null;

let mapOfCookies = new Map();


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

    password = argToParse(argToParse.length - 1);
    username = argToParse(argToParse.length - 2);

    return {
        server: setServer || server,
        port: setPort || port,
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
        }
        request += "\r\n";
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
    }
    request += "\r\n";
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
    request += "\r\n";
    return request;
}

function responseCheckerHelper(allData) {

    const headerPresent = false;
    if(allData.indexOf("\r\n\r\n") !== -1) {
        headerPresent = true;
    }
    if(!headerPresent) {
        return false;
    }

    const headerMap = new Map();
    let cookieKey = null;
    let cookieValue = null;

    const allHeaders = allData.slice(0, allData.indexOf("\r\n\r\n"));
    const allHeaderArray = allHeaders.toString("latin1").split("\r\n");

    let statusNumber = Number(allHeaderArray[0].split(" ")[1]);

    for(let i = 0; i < allHeaderArray.length; i++) {
        const headerRowArray = allHeaderArray[i].split(" ");
        const headerName = headerRowArray[0];
        const headerValue = headerRowArray[1];

        if(headerName.toLowerCase() === "set-cookie") {
            cookieKey = headerValue.split("=")[0];
            cookieValue = headerValue.split("=")[1];
            headerMap.set(cookieKey, cookieValue);
        }
        else {
            headerMap.set(headerName, headerValue);
        }
    }

    const contentLengthOrNot = headerMap.conatainsKey("Content-Length:");
    if(contentLengthOrNot) {
        const totalDataSize = Number(headerMap.get("Content-Length:"));
        const bodyStartInx = allData.indexOf("\r\n\r\n") + 4;
        if(bodyStartInx + totalDataSize > allData.length) {
            return false;
        }
        const body = allData.slice(bodyStartInx, bodyStartInx + totalDataSize);
        return {
            statusCode: statusNumber,
            headers: headerMap,
            body: body
        }
    }
    else {
        const body = Buffer.alloc(0);
        body = transferEncodingParser(allData, bodyStartInx);
        if(body === null) {
            return false;
        }
        return {
            statusCode: statusNumber,
            headers: headerMap,
            body: body
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
        if(method === "GET") {
            const request = buildGetRequestHelper(path, body);
    
        }
        else if(method === "POST") {
            const request = buildPostRequestHelper(path, body);
        }
        currentSocket.write(request);
    });
    







}

async function loginpageInfoHelper() {
    const keepLooping = true;

    const currentPath = "/accounts/login/?next=/fakebook/";
    const currentMethod = "GET";
    while(keepLooping) {
        let pageInfo;

        try {
            
            pageInfo = await sendRequestHelper(currentMethod, currentPath, null);
        
        } catch (error) {
            socket = null;
            continue;
        }

        if(pageInfo.statusCode === 200) {
            return {pageInfo: pageInfo.html, pagePath: pageInfo.path};
        }

        else if(pageInfo.statusCode === 302) {
            const newLocation = pageInfo.headers["location"];

            const newUrl = new URL(newLocation, `https://${server}:${port}${currentPath}`);
            currentPath = newUrl.pathname + newUrl.search;
            currentMethod = "GET";
        }
        else if(response.statusCode === 503) {
            continue;
        }
        else if(pageInfo.statusCode === 403 || pageInfo.statusCode === 404) {
            return null;
        }

    }
}

async function sendGetLoginPage() {
    const loginpageInfo = await loginpageInfoHelper();
}


async function main() {
    const argsFromCommand = getParamsHelper();

    currentSocket = await connectToTLS();

    //send GET to login page
    const loginPage = await sendGetLoginPage();
}

main();