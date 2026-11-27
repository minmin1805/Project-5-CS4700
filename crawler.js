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
        // console.log(pageInfo.statusCode, pageInfo.headers);

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

async function pageGetHelper(path) {
    const keepLooping = true;

    let currentPath = path;
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
        // console.log(pageInfo.statusCode, pageInfo.headers);

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
        else {
            return null;
        }

    }
}



function tokenFindHelper(loginpageInfo) {
    //get pass ...name="csrfmiddlewaretoken"
    const passFirstPart = loginpageInfo.indexOf('name="csrfmiddlewaretoken"');

    //get to the start index of the token
    const tokenStartInx = loginpageInfo.indexOf('value="', passFirstPart) + 7;

    //get to the end index of the token
    const tokenEndInx = loginpageInfo.indexOf('"', tokenStartInx);

    //get the token
    const token = loginpageInfo.slice(tokenStartInx, tokenEndInx);
    return token;
}

async function sendGetLoginPage() {
    const loginpageInfo = await loginpageInfoHelper();

    const loginformToken = tokenFindHelper(loginpageInfo.pageInfo);
    
    return {
        loginBodyInfo: loginpageInfo.pageInfo,
        loginFormToken: loginformToken
    };

}

async function sendPostLoginPage(loginBodyInfo, loginFormToken) {
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&csrfmiddlewaretoken=${encodeURIComponent(loginFormToken)}&next=/fakebook/`;

    const loginResponse = await sendRequestHelper("POST", "/accounts/login/", body);
    return loginResponse;
}

function getLinkHelper(homePageInfo) {
    const foundLinks = [];
    while(homePageInfo.includes('<a href="/fakebook/')) {
        const linkStartInx = homePageInfo.indexOf('<a href="/fakebook/');
        const pathStartInx = linkStartInx + 9;
        const pathEndInx = homePageInfo.indexOf('"', pathStartInx);
        const path = homePageInfo.slice(pathStartInx, pathEndInx);
        foundLinks.push(path);
        //move pass the "
        homePageInfo = homePageInfo.slice(pathEndInx + 1);
    }
    return foundLinks;
}

function flagCheckerHelper(homePageInfo) {
    // <h3 class='secret_flag' style="color:red">FLAG: 64 letters and numbers</h3>
    const foundFlag = new Set();
    while(homePageInfo.includes('<h3 class=\'secret_flag\' style="color:red">FLAG: ')) {
        const tagStartInx = homePageInfo.indexOf('<h3 class=\'secret_flag\' style="color:red">FLAG: ');
        const tagEndInx = tagStartInx + 48;
        const flagEnd = homePageInfo.indexOf('</h3>', tagEndInx);
        const flagWithTag = homePageInfo.slice(tagEndInx, flagEnd);
        const flag = flagWithTag.split('</h3>')[0];
        foundFlag.add(flag);
        homePageInfo = homePageInfo.slice(flagEnd + 5);
    }
    return foundFlag;
}


async function main() {
    const argsFromCommand = getParamsHelper();
    server = argsFromCommand.server;
    port = argsFromCommand.port;
    username = argsFromCommand.username;
    password = argsFromCommand.password;

    currentSocket = await connectToTLS();

    const foundFlag = new Set();
    

    //send GET to login page
    const loginPage = await sendGetLoginPage();
    // console.log(loginPage.loginFormToken.length);
    // console.log(mapOfCookies);

    //POST to login page
    const loginResponse = await sendPostLoginPage(loginPage.loginBodyInfo, loginPage.loginFormToken);
    saveCookiesHelper(loginResponse.cookies);
    // console.log(loginResponse.statusCode, loginResponse.headers);
    // console.log(Array.from(mapOfCookies.keys()));

    //GET to home page
    const getHomePageRes = await pageGetHelper("/fakebook/");
    // console.log(getHomePageRes.pageInfo);
    const flagFound = flagCheckerHelper(getHomePageRes.pageInfo.toString("utf8"));
    if(flagFound.size !== 0) {
        for(let eachFlag of flagFound) {
            if(!foundFlag.has(eachFlag)) {
                foundFlag.add(eachFlag);
            }
        }
    }

    const linksFromHomePage = getLinkHelper(getHomePageRes.pageInfo.toString("utf8"));
    // console.log(linksFromHomePage);

    const linksToVisit = [];
    const visitedAlready = new Set();

    for(let i = 0; i < linksFromHomePage.length; i++) {
        if(visitedAlready.has(linksFromHomePage[i])) {
            continue;
        }
        else {
            visitedAlready.add(linksFromHomePage[i]);
            linksToVisit.push(linksFromHomePage[i]);
        }
    }
    let linkCount = 0;
    while(linksToVisit.length > 0 && foundFlag.size !== 5) {
        linkCount++;
        const currentLink = linksToVisit.shift();
        const currentPageRes = await pageGetHelper(currentLink);

        const flagFound = flagCheckerHelper(currentPageRes.pageInfo.toString("utf8"));
        if(flagFound.size !== 0) {
            for(let eachFlag of flagFound) {
                if(!foundFlag.has(eachFlag)) {
                    foundFlag.add(eachFlag);
                }
            }
        }

        const currentPageFoundLinks = getLinkHelper(currentPageRes.pageInfo.toString("utf8"));
        for(let i = 0; i < currentPageFoundLinks.length; i++) {
            if(visitedAlready.has(currentPageFoundLinks[i])) {
                continue;
            }
            else {
                visitedAlready.add(currentPageFoundLinks[i]);
                linksToVisit.push(currentPageFoundLinks[i]);
            }
        }
        // console.log(currentLink);
        console.log(linkCount);
    }
    for(let eachFlag of foundFlag) {
        console.log(eachFlag);
    }
    currentSocket.destroy();
    process.exit(0);
}

main();