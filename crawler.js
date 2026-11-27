let server = "fakebook.khoury.northeastern.edu"

let port = 443;

const tls = require('tls');

let currentSocket = null;

let mapOfCookies = new Map();

let username = null;
let password = null;

//this is the function to connect to TLS, this is the function i did in my project 1 (similar i removed some unused parts)
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

//this is the helper function to get the params from the command line
function getParamsHelper() {
    const argToParse = process.argv.slice(2);

    let setServer = null;
    let setPort = null;

    //loop through the variables if there is -s then the server is after it and if 
    // there is -p then port number is after it
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
    //password is the last arg and the username is the second last
    password = argToParse[argToParse.length - 1];
    username = argToParse[argToParse.length - 2];

    return {
        server: setServer || server,
        port: Number(setPort) || port,
        username: username,
        password: password
    }
}

//helper function to construct the request for GET call
function buildGetRequestHelper(path, body) {
    
    let request = "";
        request += `GET ${path} HTTP/1.1`;
        request += "\r\n";
        //if there is a specific port numner then attach it to the host atr
        if(port !== 443) {
            request += `Host: ${server}:${port}`;
        }
        else {
            request += `Host: ${server}`;
        }
        request += "\r\n";

        let cookieList = [];

        //include the cookies with the request, each cookie is separate with the ;
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

//helper function to construct the request for POST call
function buildPostRequestHelper(path, body) {
    let request = "";
    request += `POST ${path} HTTP/1.1`;
    request += "\r\n";
    //if there is a specific port numner then attach it to the host atr
    if(port !== 443) {
        request += `Host: ${server}:${port}`;
    }
    else {
        request += `Host: ${server}`;
    }
    request += "\r\n";

    //include the cookies with the request each cookie is separate with the ;
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
    //include the content-type, content-length
    request += "Content-Type: application/x-www-form-urlencoded";
    request += "\r\n";
    request += `Content-Length: ${Buffer.byteLength(body)}`;
    request += "\r\n";
    request += "\r\n";
    //include the body of the request
    request += body;
    return request;
}


//helper function to process each atributes from the response from the server
function responseCheckerHelper(allData) {

    let headerPresent = false;
    //check if the header is present
    if(allData.indexOf("\r\n\r\n") !== -1) {
        headerPresent = true;
    }
    //if this triggers then need to wait more data to come
    if(!headerPresent) {
        return null;
    }

    //exact the headers from the response
    const allHeaders = allData.slice(0, allData.indexOf("\r\n\r\n"));
    const allHeaderArray = allHeaders.toString().split("\r\n");

    //get the status number
    let statusNumber = Number(allHeaderArray[0].split(" ")[1]);

    //these are the variables to store the atributes
    const headerMap = new Map();
    const cookieMap = new Map();
    let cookieKey = null;
    let cookieValue = null;
    
    //loop through the header and process them
    for(let i = 1; i < allHeaderArray.length; i++) {
        const colonIndex = allHeaderArray[i].indexOf(":");
        const headerName = allHeaderArray[i].slice(0, colonIndex).trim().toLowerCase();
        const headerValue = allHeaderArray[i].slice(colonIndex + 1).trim();

        //if this header is set-cookie then add it to the map
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

    //there is 2 enters so + 4 will = the start index of the body
    const bodyStartInx = allData.indexOf("\r\n\r\n") + 4;
    const contentLengthOrNot = headerMap.has("content-length");

    //if content-length atribute is given then just compare the size
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

}

//helper function to send the request to the server + receive response from server
async function sendRequestHelper(method, path, body) {
    return new Promise((resolve, reject) => {
        let allData = Buffer.alloc(0);

        //get the chunk and keep checking if the response is complete
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

        //listen to the data + watch to know when to close
        currentSocket.on("data", updateData);
        currentSocket.on("close", closeSocket);
        let request;
        //the 2 conditions below are used to build the request format for GET and POST
        if(method === "GET") {
            request = buildGetRequestHelper(path, body);
    
        }
        else if(method === "POST") {
            request = buildPostRequestHelper(path, body);
        }
        currentSocket.write(request);
    });
    
}

//helper function to save the cookies to the map
function saveCookiesHelper(setCookies) {
    const cookieNames = Array.from(setCookies.keys());
    for(let i = 0; i < cookieNames.length; i++) {
        mapOfCookies.set(cookieNames[i], setCookies.get(cookieNames[i]));
    }
}

//helper function to process the GET call to the login page
async function loginpageInfoHelper() {
    const keepLooping = true;

    let currentPath = "/accounts/login/";
    let currentMethod = "GET";
    while(keepLooping) {
        let pageInfo;

        try {
            //send request to the login page + also receive response from it
            pageInfo = await sendRequestHelper(currentMethod, currentPath, null);

        } catch (error) {
            continue;
        }

        //update the map of cookies
        saveCookiesHelper(pageInfo.cookies);
        // console.log(pageInfo.statusCode, pageInfo.headers);

        //if code = 200 then return the page info
        if(pageInfo.statusCode === 200) {
            return {
                pageInfo: pageInfo.body.toString("utf8"), 
                pagePath: currentPath
            };
        }

        //if code = 302 then need to redirect to new location
        else if(pageInfo.statusCode === 302) {
            const newLocation = pageInfo.headers.get("location");

            currentPath = newLocation;
            currentMethod = "GET";
        }
        //if code = 503 then continue looping
        else if(pageInfo.statusCode === 503) {
            continue;
        }
        //if code = 403/404 then return null
        else if(pageInfo.statusCode === 403 || pageInfo.statusCode === 404) {
            return null;
        }

    }
}

//helper function to process the GET call from a specific path
async function pageGetHelper(path) {
    const keepLooping = true;

    let currentPath = path;
    let currentMethod = "GET";
    while(keepLooping) {
        let pageInfo;

        try {
            //send request to the specific path + also receive response from it
            pageInfo = await sendRequestHelper(currentMethod, currentPath, null);

        } catch (error) {
            continue;
        }

        //update the map of cookies
        saveCookiesHelper(pageInfo.cookies);
        // console.log(pageInfo.statusCode, pageInfo.headers);

        //if code = 200 then return the page info
        if(pageInfo.statusCode === 200) {
            return {
                pageInfo: pageInfo.body.toString("utf8"), 
                pagePath: currentPath
            };
        }
        //if code = 302 then need to redirect to new location
        else if(pageInfo.statusCode === 302) {
            const newLocation = pageInfo.headers.get("location");

            currentPath = newLocation;
            currentMethod = "GET";
        }
        //if code = 503 then continue looping
        else if(pageInfo.statusCode === 503) {
            continue;
        }

        else {
            return null;
        }

    }
}


//this is helper function to find the token in the login page
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

//this is helper function to get the login page info (both info + token)
async function sendGetLoginPage() {
    //send the GET request then receive the response from it
    const loginpageInfo = await loginpageInfoHelper();

    //get the token
    const loginformToken = tokenFindHelper(loginpageInfo.pageInfo);
    
    return {
        loginBodyInfo: loginpageInfo.pageInfo,
        loginFormToken: loginformToken
    };

}

//helper function to send POST request to the login page
async function sendPostLoginPage(loginBodyInfo, loginFormToken) {
    //this build the body of the POST request
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&csrfmiddlewaretoken=${encodeURIComponent(loginFormToken)}`;

    //send the POST request then receive the response from it
    const loginResponse = await sendRequestHelper("POST", "/accounts/login/", body);
    return loginResponse;
}

//helper function to get the links from a specific page
function getLinkHelper(pageInfo) {
    const foundLinks = [];

    //loop through the entire page until there is no more link
    while(pageInfo.includes('<a href="/fakebook/')) {
        //what i did is i exact the index for the beginning + end of the link and then slice it
        const linkStartInx = pageInfo.indexOf('<a href="/fakebook/');
        const pathStartInx = linkStartInx + 9;
        const pathEndInx = pageInfo.indexOf('"', pathStartInx);
        const path = pageInfo.slice(pathStartInx, pathEndInx);
        foundLinks.push(path);
        //move pass the " (this will be loop again)
        pageInfo = pageInfo.slice(pathEndInx + 1);
    }
    return foundLinks;
}

//helper function check if there are flags in this page
function flagCheckerHelper(pageInfo) {
    

    const foundFlag = new Set();
    //loop through the entire page until there is no more flag
    while(pageInfo.includes('<h3 class=\'secret_flag\' style="color:red">FLAG: ')) {
        //what i did is i exact the index for the beginning + end of the flag and then slice it
        const tagStartInx = pageInfo.indexOf('<h3 class=\'secret_flag\' style="color:red">FLAG: ');
        const tagEndInx = tagStartInx + 48;
        const flagEnd = pageInfo.indexOf('</h3>', tagEndInx);
        const flagWithTag = pageInfo.slice(tagEndInx, flagEnd);
        //split into 2 elements array and then flag is the 1st element
        const flag = flagWithTag.split('</h3>')[0];
        foundFlag.add(flag);
        //move pass the flag (this will be loop again)
        pageInfo = pageInfo.slice(flagEnd + 5);
    }
    return foundFlag;
}

//main function this function will be triggered first
async function main() {
    //get the parameters from the command line
    const argsFromCommand = getParamsHelper();
    server = argsFromCommand.server;
    port = argsFromCommand.port;
    username = argsFromCommand.username;
    password = argsFromCommand.password;

    //connect to the server
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

    //GET to home page
    const getHomePageRes = await pageGetHelper("/fakebook/");
    // console.log(getHomePageRes.pageInfo);

    //check if there are flags in the home page
    const flagFound = flagCheckerHelper(getHomePageRes.pageInfo.toString("utf8"));
    if(flagFound.size !== 0) {
        for(let eachFlag of flagFound) {
            if(!foundFlag.has(eachFlag)) {
                foundFlag.add(eachFlag);
            }
        }
    }

    //get all of the links from the home page
    const linksFromHomePage = getLinkHelper(getHomePageRes.pageInfo.toString("utf8"));
    // console.log(linksFromHomePage);

    const linksToVisit = [];
    const visitedAlready = new Set();

    //loop through the links and add them to array (queue)
    for(let i = 0; i < linksFromHomePage.length; i++) {
        //if has this link already then skip it
        if(visitedAlready.has(linksFromHomePage[i])) {
            continue;
        }
        //else add to the queue
        else {
            visitedAlready.add(linksFromHomePage[i]);
            linksToVisit.push(linksFromHomePage[i]);
        }
    }
    let linkCount = 0;
    //my linksToVisit is like a queue, i will loop and pop each and then find the flags + links for each
    while(linksToVisit.length > 0 && foundFlag.size !== 5) {
        linkCount++;
        const currentLink = linksToVisit.shift();
        const currentPageRes = await pageGetHelper(currentLink);

        //check for flags
        const flagFound = flagCheckerHelper(currentPageRes.pageInfo.toString("utf8"));
        if(flagFound.size !== 0) {
            for(let eachFlag of flagFound) {
                if(!foundFlag.has(eachFlag)) {
                    foundFlag.add(eachFlag);
                }
            }
        }

        //check for links 
        const currentPageFoundLinks = getLinkHelper(currentPageRes.pageInfo.toString("utf8"));
        for(let i = 0; i < currentPageFoundLinks.length; i++) {
            //if already in visitedAlready then skip
            if(visitedAlready.has(currentPageFoundLinks[i])) {
                continue;
            }
            //else add to queue
            else {
                visitedAlready.add(currentPageFoundLinks[i]);
                linksToVisit.push(currentPageFoundLinks[i]);
            }
        }
        // console.log(currentLink);
        // console.log(linkCount);
    }
    for(let eachFlag of foundFlag) {
        console.log(eachFlag);
    }
    currentSocket.destroy();
    process.exit(0);
}

main();