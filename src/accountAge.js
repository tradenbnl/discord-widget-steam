// src/accountAge.js
//
// Calculates account age based on `timecreated`
// (Unix timestamp) returned by GetPlayerSummaries.

export function describeAccountAge(timecreated) {
  if (!timecreated) {
    return {
      createdLabel: "Unknown",
      ageLabel: "Unknown",
      memberSinceYear: null,
    };
  }

  const createdDate = new Date(timecreated * 1000);
  const now = new Date();

  const memberSinceYear = createdDate.getFullYear();

  let years = now.getFullYear() - createdDate.getFullYear();
  let months = now.getMonth() - createdDate.getMonth();

  if (now.getDate() < createdDate.getDate()) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const createdLabel = createdDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const yearWord = years === 1 ? "year" : "years";
  const monthWord = months === 1 ? "month" : "months";

  let ageLabel;
  if (years > 0 && months > 0) {
    ageLabel = `${years} ${yearWord} and ${months} ${monthWord}`;
  } else if (years > 0) {
    ageLabel = `${years} ${yearWord}`;
  } else if (months > 0) {
    ageLabel = `${months} ${monthWord}`;
  } else {
    ageLabel = "Less than a month";
  }

  return { createdLabel, ageLabel, memberSinceYear };
}
