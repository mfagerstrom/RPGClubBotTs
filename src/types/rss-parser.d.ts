declare module "rss-parser" {
  export interface IParserOptions {
    timeout?: number;
  }

  export interface IItem {
    title?: string;
    link?: string;
    guid?: string;
    content?: string;
    contentSnippet?: string;
    pubDate?: string;
  }

  export interface IFeed {
    items?: IItem[];
  }

  export default class Parser {
    constructor(options?: IParserOptions);
    parseURL(url: string): Promise<IFeed>;
  }
}
