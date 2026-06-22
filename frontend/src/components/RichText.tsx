import React from "react";
import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";

interface RichTextProps {
  text: string;
}

const clickableTokenSx = {
  color: "primary.main",
  cursor: "pointer",
  fontWeight: 700,
  "&:hover": {
    color: "primary.light",
    textDecoration: "underline",
  },
};

/**
 * This component detects hashtags and mentions in text and makes them clickable
 * Hashtags - #word - /search/tags?tags=word
 * Mentions - @handle - /profile/handle
 */
const RichText: React.FC<RichTextProps> = ({ text }) => {
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
          <Box
            component="span"
            key={`hashtag-${matchIndex}`}
            sx={clickableTokenSx}
            onClick={(e) => handleHashtagClick(token, e)}
          >
            {token}
          </Box>,
        );
      } else if (token.startsWith("@")) {
        parts.push(
          <Box
            component="span"
            key={`mention-${matchIndex}`}
            sx={clickableTokenSx}
            onClick={(e) => handleMentionClick(token, e)}
          >
            {token}
          </Box>,
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
    <Box
      component="span"
      sx={{
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {renderContent()}
    </Box>
  );
};

export default RichText;
