import axios from 'axios';
import * as cheerio from 'cheerio';
import UserAgent from 'user-agents';
import { google } from 'googleapis';
export async function searchHltb(title) {
    const hltbQuery = title;
    const searchData = await searchGoogleCustomSearchAPI(`How long is ${hltbQuery}?`);
    // grab the first link of the bunch and pull out the id from it
    const hltbUrl = searchData[0].link;
    // and scrape it
    const hltbGameHTML = await fetchPage(hltbUrl);
    const $ = cheerio.load(hltbGameHTML);
    // grab the data that we need with cheerio
    const result = {
        name: $('.GameHeader_profile_header__q_PID').text().trim(),
        main: $('h4:contains("Main Story")').next().text(),
        mainSides: $('h4:contains("Main + Sides")').next().text(),
        completionist: $('h4:contains("Completionist")').next().text(),
        singlePlayer: $('h4:contains("Single-Player")').next().text(),
        coOp: $('h4:contains("Co-Op")').next().text(),
        vs: $('h4:contains("Vs.")').next().text(),
        imageUrl: $('img').attr('src'),
    };
    return result;
}
async function searchGoogleCustomSearchAPI(query) {
    const customSearch = google.customsearch('v1');
    const apiKey = process.env.GOOGLE_API_KEY;
    const searchEngineId = process.env.SEARCH_ID;
    try {
        const response = await customSearch.cse.list({
            auth: apiKey,
            cx: searchEngineId,
            q: query,
        });
        if (response.data.items) {
            return response.data.items;
        }
        else {
            console.log('No results found.');
        }
    }
    catch (error) {
        console.error('Error performing search:', error);
    }
}
async function fetchPage(url) {
    const HTMLData = await axios
        .get(url, {
        headers: {
            'User-Agent': new UserAgent().toString(),
            'origin': 'https://howlongtobeat.com',
            'referer': 'https://howlongtobeat.com'
        },
    })
        .then(res => res.data)
        .catch((error) => {
        if (error.config) {
            console.error(`There was an error with ${error.config.url}.`);
        }
        console.error(error.toJSON());
    });
    return HTMLData;
}
