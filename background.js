function notify(msg) {
    let logo = chrome.runtime.getURL('./icons/Icon.png')
    chrome.notifications.create({
        type: "basic",
        iconUrl: logo,
        title: "Spotify Artist Chart",
        message: msg,
    });
}

chrome.runtime.onInstalled.addListener(async function (details) {
    if (details.reason === "install") {
        notify("Install this extension to display a chart of all tracks by an artist on Spotify with just one click.")
    }

});

async function signIn() {
    function randomString(length) {
        var result = '';
        var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (var i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    var codeVerifier = randomString(64);

    async function digestMessage(message) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        return await crypto.subtle.digest('SHA-256', data);
    }

    const hash = await digestMessage(codeVerifier);
    let codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    var scopes = 'playlist-read-private playlist-modify-public playlist-modify-private user-read-private user-read-email';
    var url = 'https://accounts.spotify.com/authorize?response_type=code&code_challenge_method=S256&code_challenge=' + codeChallenge + '&client_id=23d975502f2a427ca3820682611ec480' +
        (scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
        '&redirect_uri=' + encodeURIComponent(chrome.identity.getRedirectURL('spotify'));
    var urlString = await chrome.identity.launchWebAuthFlow(
        {
            url: url,
            interactive: true
        }
    );
    var url = new URL(urlString);
    var code = url.searchParams.get('code');
    var authResult = await fetch(
        'https://accounts.spotify.com/api/token',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: '23d975502f2a427ca3820682611ec480',
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: chrome.identity.getRedirectURL('spotify'),
                code_verifier: codeVerifier
            })
        }
    ).then(response => response.json());

    await chrome.storage.local.set({
        accessToken: authResult.access_token,
        refreshToken: authResult.refresh_token,
        accessTokenExpiresAt: Date.now() + (authResult.expires_in - 30) * 1000
    })


}

async function retrieveAccessToken() {
    const currentAccessTokenExpiresAt = (await chrome.storage.local.get('accessTokenExpiresAt')).accessTokenExpiresAt || null;
    const currentAccessToken = (await chrome.storage.local.get('accessToken')).accessToken || null;
    if (currentAccessToken && (currentAccessTokenExpiresAt - 30000) > Date.now()) {
        const meResponse = await fetch(
            'https://api.spotify.com/v1/me',
            {
                headers: { 'Authorization': 'Bearer ' + currentAccessToken }
            }
        )
        let me = await meResponse.json()
        if (!me.error) {
            return currentAccessToken;
        }
    }
    const refreshToken = (await chrome.storage.local.get('refreshToken')).refreshToken || null;
    if (!refreshToken) {
        await chrome.storage.local.remove(['accessToken', 'refreshToken', 'accessTokenExpiresAt']);
        return null;
    }
    var authResult = await fetch(
        'https://accounts.spotify.com/api/token',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: '23d975502f2a427ca3820682611ec480',
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        }
    ).then(response => response.json());

    if (authResult.error) {
        await chrome.storage.local.remove(['accessToken', 'refreshToken', 'accessTokenExpiresAt']);
        return null;
    }

    await chrome.storage.local.set({
        accessToken: authResult.access_token,
        refreshToken: authResult.refresh_token,
        accessTokenExpiresAt: Date.now() + (authResult.expires_in - 30) * 1000
    })
    return authResult.access_token;
}

async function showAllSongs(artistId) {
    const accessToken = await retrieveAccessToken();
    if (!accessToken) {
        signIn();
        return null;
    }

    let headers = { headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }) };

    var artistName = await fetch(
        'https://api.spotify.com/v1/artists/' + artistId,
        headers
    ).then(response => response.json())
        .then(({ name }) => name);


    let albumIds = [];
    var next = 'https://api.spotify.com/v1/artists/' + artistId + '/albums?include_groups=album,single&limit=50';
    while (next) {
        var result = await fetch(
            next,
            headers
        ).then(response => response.json());

        result.items.forEach(item => albumIds.push(item.id));
        next = result.next;
    }



    var trackIds = [];
    for (var page = 0; page <= albumIds.length / 20; page++) {
        var albumIdsChunk = albumIds.slice(page * 20, (page + 1) * 20);

        var albums = await fetch(
            'https://api.spotify.com/v1/albums?ids=' + albumIdsChunk.join(','),
            headers
        ).then(response => response.json())
            .then(json => json.albums.map(album => album.tracks));

        for (const album of albums) {
            album.items.forEach(item => trackIds.push(item.id));

            var next = album.next;
            while (next) {
                var tracks = await fetch(
                    next,
                    headers
                ).then(response => response.json());

                next = tracks.next;
                tracks.items.forEach(item => trackIds.push(item.id));
            }
        }
    }


    var playlists = [];
    var next = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (next) {
        var result = await fetch(
            next,
            headers
        ).then(response => response.json());

        result.items.forEach(item => playlists.push(item));
        next = result.next;
    }


    var playlistId = null;
    var playlistUrl = null;
    for (const playlist of playlists) {
        if (playlist.name === artistName) {
            playlistId = playlist.id;
            playlistUrl = playlist.external_urls.spotify;
            break;
        }
    }

    if (!playlistId) {

        var playlist = await fetch(
            'https://api.spotify.com/v1/me/playlists',
            {
                method: 'POST',
                body: JSON.stringify({
                    name: artistName,
                    public: false
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + accessToken
                }
            },
        ).then(response => response.json());

        playlistId = playlist.id;
        playlistUrl = playlist.external_urls.spotify;
    }



    var playlistTrackIds = [];
    var next = 'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks?fields=next,items(track(id))&limit=100';
    while (next) {
        var result = await fetch(
            next,
            headers
        ).then(response => response.json());

        result.items.forEach(item => playlistTrackIds.push(item.track.id));
        next = result.next;
    }



    if (playlistTrackIds.length) {
        for (var page = 0; page <= playlistTrackIds.length / 100; page++) {
            var playlistTrackIdsChunk = playlistTrackIds.slice(page * 100, (page + 1) * 100);

            var resultRemoveTracks = await fetch(
                'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks',
                {
                    method: 'DELETE',
                    body: JSON.stringify({
                        uris: playlistTrackIdsChunk.map(trackId => 'spotify:track:' + trackId)
                    }),
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + accessToken
                    }
                },
            ).then(response => response.json());

        }
    }

    for (var page = 0; page <= trackIds.length / 100; page++) {
        var trackIdsChunk = trackIds.slice(page * 100, (page + 1) * 100);

        var result = await fetch(
            'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks',
            {
                method: 'POST',
                body: JSON.stringify({
                    uris: trackIdsChunk.map(trackId => 'spotify:track:' + trackId)
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + accessToken
                }
            },
        ).then(response => response.json());


    }

    let tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    chrome.tabs.update(tab.id, { url: playlistUrl });

    return {
        playlistUrl: playlistUrl
    };
}

async function getArtist(artistId) {
    const accessToken = await retrieveAccessToken();
    if (!accessToken) {
        signIn();
        return null;
    }

    const artist = await fetch(
        'https://api.spotify.com/v1/artists/' + artistId,
        {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        }
    ).then(response => response.json());

    return {
        name: artist.name,
        image: artist.images[0].url
    };
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    switch (message.command) {
        case 'signIn':
            signIn();
            break;
        case 'songs':
            showAllSongs(message.artistId).then(result => {
                sendResponse(result)
            });
            break;
        case 'get-artist':
            getArtist(message.artistId).then(result => {
                sendResponse(result)
            });
            break;
    }
    return true;
});




