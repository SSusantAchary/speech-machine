export const isSafariBrowser = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  return /safari/i.test(userAgent) && !/chrome|crios|android/i.test(userAgent);
};
