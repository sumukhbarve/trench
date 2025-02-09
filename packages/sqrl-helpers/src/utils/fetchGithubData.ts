import axios, { AxiosError } from "axios";
import axiosRetry from "axios-retry";
import * as cheerio from "cheerio";

const parseDay = (day: cheerio.Cheerio<cheerio.Element>) => {
  return {
    date: day.attr("data-date"),
    count: parseInt(day.text().split(" ")[0], 10) || 0,
    intensity: day.attr("data-level") ?? 0,
  };
};

axiosRetry(axios, {
  retries: 3,
  // eslint-disable-next-line @typescript-eslint/unbound-method
  retryDelay: axiosRetry.exponentialDelay,
  shouldResetTimeout: true,
  onRetry: (err) => {
    console.log("retrying...", err);
  },
});

export async function fetchUserData(username: string) {
  let data;
  try {
    const response = await axios<string>(
      `${process.env.GITHUB_URL}/${username}`,
      {
        timeout: 3000,
      }
    );
    data = response.data;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 404) {
      return null;
    }
    throw error;
  }

  const $ = cheerio.load(data);
  const fullName = $(".p-name").text().trim();
  const bio = $(".user-profile-bio").text().trim();
  const followers =
    $("a[href*='?tab=followers'] .text-bold").text().trim() || 0;
  const following =
    $("a[href*='?tab=following'] .text-bold").text().trim() || 0;
  const company = $(".p-org div").text().trim();
  const location = $(".p-label").text().trim();
  const websiteUrl = $("li[itemprop='url'] a").text().trim();
  const createdYear = $(".js-year-link").last().text().trim();
  const isPro = $("span.Label--purple.text-uppercase").text().trim() === "Pro";
  const readmeContent = $(
    "div.profile-readme > div.Box-body > article.markdown-body"
  )
    .text()
    .trim();

  const socialLinks: string[] = [];
  $('li[itemprop="social"]').each((index, element) => {
    const link = $(element).find("a.Link--primary").attr("href");
    if (link) socialLinks.push(link.trim());
  });

  const repositories = parseInt(
    $("a[data-tab-item='repositories'] .Counter").attr("title") ?? "0",
    10
  );
  const stars = parseInt(
    $("a[data-tab-item='stars'] .Counter").attr("title") ?? "0",
    10
  );
  const projects = parseInt(
    $("a[data-tab-item='projects'] .Counter").attr("title") ?? "0",
    10
  );
  const packages = parseInt(
    $("a[data-tab-item='packages'] .Counter").attr("title") ?? "0",
    10
  );
  const sponsoring = parseInt(
    $("a[data-tab-item='sponsoring'] .Counter").attr("title") ?? "0",
    10
  );

  const organizations: { name?: string; avatar?: string; url?: string }[] = [];
  const achievements: {
    name?: string;
    imgSrc?: string;
    tier: string;
    url?: string;
  }[] = [];
  const pinnedRepos: {
    title: string;
    url: string;
    description: string;
    isForked: boolean;
    programmingLanguage: string;
    stars: number;
    forks: number;
  }[] = [];

  $("li.mb-3").each((index, element) => {
    pinnedRepos.push({
      title: $(element).find("a.text-bold").text().trim(),
      url: $(element).find("a.text-bold").attr("href")?.trim() ?? "",
      description: $(element).find("p.pinned-item-desc").text().trim(),
      programmingLanguage: $(element)
        .find('span[itemprop="programmingLanguage"]')
        .text()
        .trim(),
      isForked: $(element).text().includes("Forked from"),
      stars:
        parseInt($(element).find('a[href$="/stargazers"]').text().trim(), 10) ||
        0,
      forks:
        parseInt($(element).find('a[href$="/forks"]').text().trim(), 10) || 0,
    });
  });

  $("a.avatar-group-item").each((index, element) => {
    organizations.push({
      name: $(element).attr("aria-label"),
      avatar: $(element).find("img.avatar").attr("src"),
      url: $(element).attr("href"),
    });
  });

  $(".border-top.color-border-muted.pt-3.mt-3.d-none.d-md-block")
    .find(".d-flex.flex-wrap a")
    .each((index, element) => {
      achievements.push({
        url: $(element).attr("href"),
        imgSrc: $(element).find("img").attr("src"),
        name: $(element).find("img").attr("alt")?.replace("Achievement: ", ""),
        tier: $(element).find(".achievement-tier-label").text(),
      });
    });

  const sponsoringDiv = $(
    ".border-top.color-border-muted.pt-3.mt-3.clearfix.hide-sm.hide-md"
  );

  const sponsors: { url: string; avatar: string; username: string }[] = [];
  const sponsorees: { url: string; avatar: string; username: string }[] = [];

  sponsoringDiv.find(".d-flex.mb-1.mr-1").each((i, el) => {
    const user = {
      url: $(el).find("a").attr("href") ?? "",
      avatar: $(el).find("img").attr("src") ?? "",
      username: $(el).find("img").attr("alt")?.replace("@", "") ?? "",
    };
    if (sponsoringDiv.text().includes("Sponsors")) sponsors.push(user);
    else if (sponsoringDiv.text().includes("Sponsoring")) sponsorees.push(user);
  });

  // console.log("Sponsoring Users: ", sponsoringUsers);

  const $days = $(
    "table.ContributionCalendar-grid td.ContributionCalendar-day"
  );
  const contributionText = $(".js-yearly-contributions h2")
    .text()
    .trim()
    .match(/^([0-9,]+)\s/);
  let contributionsPastYear;
  if (contributionText) {
    [contributionsPastYear] = contributionText;
    contributionsPastYear = parseInt(
      contributionsPastYear.replace(/,/g, ""),
      10
    );
  }

  const days = $days.get().map((day) => parseDay($(day)));
  let createdDate;
  if (createdYear === "2023")
    createdDate = days.find((day) => day.count > 0)?.date;

  return {
    fullName,
    username,
    bio,
    followers,
    following,
    company,
    location,
    websiteUrl,
    repositories,
    stars,
    projects,
    packages,
    sponsoring,
    socialLinks,
    isPro,
    contributionsPastYear,
    createdYear,
    createdDate,
    readmeContent,
    sponsors,
    sponsorees,
    organizations,
    achievements,
    pinnedRepos,
  };
}
