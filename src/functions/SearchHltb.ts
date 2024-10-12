import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import UserAgent from 'user-agents';

export async function searchHltb(title: string) {
    const hltbQuery: string = title;

    // search google for the title, using a site constraint
    const googleUrl = `https://www.google.com/search?q=site${encodeURI(':howlongtobeat.com')}+${encodeURI(hltbQuery)}`;

    // grab all the search result links
    const hltbUrlObjects = await axios.get(googleUrl, { responseEncoding: "latin1" })
        .then(({ data: html }) => {
            const $ = cheerio.load(html);
            const data = [...$(".egMi0")]
                .map(e => ({
                    title: $(e).find("h3").text().trim(),
                    href: $(e).find("a").attr("href"),
                }));
            return data;
        })
        .catch(err => console.error(err));

    // grab the first link of the bunch and pull out the id from it
    // @ts-ignore
    const hltbMessyUrl: string = hltbUrlObjects[0].href;
    const hltbId: string = hltbMessyUrl!.match(/\d+/)![0];

    // use the id to construct the hltb detail url
    const hltbGameUrl: string = `https://howlongtobeat.com/game/${hltbId}`;

    // and scrape it
    const hltbGameHTML: string = await fetchPage(hltbGameUrl);
    const $ = cheerio.load(hltbGameHTML);

    // grab the data that we need with cheerio
    const result = {
        name: $('.GameHeader_profile_header__q_PID').text().trim(),
        id: hltbId,
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

async function fetchPage(url: string) {
    const HTMLData = await axios
        .get(url, {
            headers: {
                'User-Agent': new UserAgent().toString(),
                'origin': 'https://howlongtobeat.com',
                'referer': 'https://howlongtobeat.com'
            },
        })
        .then(res => res.data)
        .catch((error: AxiosError) => {
            if (error.config) {
                console.error(`There was an error with ${error.config.url}.`);
            }
            console.error(error.toJSON());
        });
    return HTMLData;
}