

async function getExtensionState() {
    const signedIn = !!(await chrome.storage.local.get('accessToken'));
    if (!signedIn) {
        return 'not-signed-in';
    }

    var url = new URL((await chrome.tabs.query({active: true, currentWindow: true}))[0].url);
    if (url.host.indexOf('spotify.com') === -1) {
        return 'signed-in-not-on-spotify';
    }

    if (url.pathname.indexOf('/artist/') !== 0) {
        return 'signed-in-not-on-artist';
    }

    return 'ready';
}

getExtensionState()
    .then(async result => {
        document.getElementById(result).style.display = 'block';
        if (result !== 'ready') {
            return;
        }

        var url = new URL((await chrome.tabs.query({active: true, currentWindow: true}))[0].url);
        var artistId = url.pathname.split('/')[2];
        chrome.runtime.sendMessage(
            {command: 'get-artist', artistId: artistId},
            result => {
                if (!result) {
                    var windows = chrome.extension.getViews({type: "popup"});
                    if (windows.length) {
                        windows[0].close();
                    }
                    return;
                }
                document.getElementById('image').classList.remove('loading');
                document.getElementById('artist-name').textContent = result.name;
                document.getElementById('image').style.backgroundImage = 'url(' + result.image + ')';
            }
        );
    });


let signIn = document.getElementById('sign-in');
let songs = document.getElementById('songs');

signIn.onclick = function () {
    chrome.runtime.sendMessage({command: 'signIn'});
    window.close();
};

songs.onclick = async function (element) {
    let tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    var url = new URL(tab.url);
    var artistId = url.pathname.split('/')[2];
    document.getElementById('ready').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    chrome.runtime.sendMessage(
        {command: 'songs', artistId: artistId},
        result => {
            if (!result) {
                var windows = chrome.extension.getViews({type: "popup"});
                if (windows.length) {
                    windows[0].close();
                }
                return;
            }

            document.getElementById('loading').style.display = 'none';
            document.getElementById('finished').style.display = 'block';
        }
    );
};
