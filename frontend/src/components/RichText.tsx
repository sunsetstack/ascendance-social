import React from "react";
import { useNavigate } from "react-router-dom";

interface RichTextProps {
  text: string;
  className?: string;
  hashtagClassName?: string;
  mentionClassName?: string;
}

/**
 * This component detects hashtags and mentions in text and makes them clickable
 * Hashtags - #word - /search/tags?tags=word
 * Mentions - @handle - /profile/handle
 */
const RichText: React.FC<RichTextProps> = ({
  text,
  className = "",
  hashtagClassName = "text-accent hover:text-accent-hover cursor-pointer font-bold hover:underline",
  mentionClassName = "text-accent cursor-pointer font-bold hover:underline",
}) => {
  const navigate = useNavigate();

  // Regex to match hashtags for words and mentions with '#' or '@'
  // Matches alphanumeric and underscores, including unicode characters for hashtags
  const tokenRegex = /((?:#[\p{L}\p{N}_]+)|(?:@[a-zA-Z0-9._]+))/gu;

  const handleHashtagClick = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // strip '#'
    const cleanTag = tag.substring(1);

    if (!cleanTag) return;

    navigate(`/results/?q=${encodeURIComponent(`#${cleanTag}`)}`);
  };

  const handleMentionClick = (mention: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Strip '@'
    const handle = mention.substring(1);

    if (!handle) return;

    navigate(`/profile/${encodeURIComponent(handle)}`);
  };

  const renderContent = () => {
    if (!text) return null;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    // Reset regex state just in case
    tokenRegex.lastIndex = 0;

    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      const matchIndex = match.index;

      // Add plain text before the token
      if (matchIndex > lastIndex) {
        parts.push(text.substring(lastIndex, matchIndex));
      }

      if (token.startsWith("#")) {
        parts.push(
          <span
            key={`hashtag-${matchIndex}`}
            className={hashtagClassName}
            onClick={(e) => handleHashtagClick(token, e)}
          >
            {token}
          </span>,
        );
      } else if (token.startsWith("@")) {
        parts.push(
          <span
            key={`mention-${matchIndex}`}
            className={mentionClassName}
            onClick={(e) => handleMentionClick(token, e)}
          >
            {token}
          </span>,
        );
      }

      lastIndex = matchIndex + token.length;
    }

    // Add remaining plain text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  };

  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {renderContent()}
    </span>
  );
};

export default RichText;
