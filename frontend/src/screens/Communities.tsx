import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  Container,
  CircularProgress,
  Tabs,
  Tab,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import {
  useCommunities,
  useUserCommunities,
} from "../hooks/communities/useCommunities";
import CommunityCard from "../components/CommunityCard";
import CreateCommunityModal from "../components/CreateCommunityModal";
import { useAuth } from "../hooks/context/useAuth";
import SearchBox from "../components/SearchBox";
import { PageSeo } from "../lib/PageSeo";
import { buildCommunitiesMetadata } from "../lib/seo";

const Communities: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [tabValue, setTabValue] = useState(0);
  const { isLoggedIn } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Discovery Query
  const {
    data: discoveryData,
    fetchNextPage: fetchNextDiscovery,
    hasNextPage: hasNextDiscovery,
    isFetchingNextPage: isFetchingNextDiscovery,
    isLoading: isDiscoveryLoading,
  } = useCommunities();

  // My Communities Query
  const {
    data: myCommunitiesData,
    fetchNextPage: fetchNextMyCommunities,
    hasNextPage: hasNextMyCommunities,
    isFetchingNextPage: isFetchingNextMyCommunities,
    isLoading: isMyCommunitiesLoading,
  } = useUserCommunities(isLoggedIn && tabValue === 1);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const activeData = tabValue === 0 ? discoveryData : myCommunitiesData;
  const communities = activeData?.pages.flatMap((page) => page.data) || [];
  const isLoading =
    tabValue === 0 ? isDiscoveryLoading : isMyCommunitiesLoading;
  const hasNextPage = tabValue === 0 ? hasNextDiscovery : hasNextMyCommunities;
  const isFetchingNextPage =
    tabValue === 0 ? isFetchingNextDiscovery : isFetchingNextMyCommunities;
  const fetchNextPage =
    tabValue === 0 ? fetchNextDiscovery : fetchNextMyCommunities;

  useEffect(() => {
    if (!isLoggedIn && tabValue !== 0) {
      setTabValue(0);
    }
  }, [isLoggedIn, tabValue]);

  useEffect(() => {
    const currentRef = loadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );

    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <>
      <PageSeo {...buildCommunitiesMetadata()} />
      <Container
        maxWidth="md"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 2, sm: 3 } }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            justifyContent: "space-between",
            alignItems: { xs: "stretch", sm: "center" },
            gap: 2,
            mb: 3,
          }}
        >
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontSize: { xs: "1.75rem", sm: "2.125rem" } }}
          >
            Communities
          </Typography>
          {isLoggedIn && (
            <Button
              variant="contained"
              onClick={() => setIsModalOpen(true)}
              startIcon={<AddIcon />}
              sx={{
                alignSelf: { xs: "stretch", sm: "auto" },
                py: { xs: 1.25, sm: 1 },
              }}
            >
              Create Community
            </Button>
          )}
        </Box>

        <Box sx={{ mb: 3 }}>
          <SearchBox />
        </Box>

        <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            aria-label="community tabs"
            variant={isMobile ? "fullWidth" : "standard"}
          >
            <Tab label="Find Communities" />
            {isLoggedIn && <Tab label="My Communities" />}
          </Tabs>
        </Box>

        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box>
            {communities.map((community) => (
              <CommunityCard key={community.publicId} community={community} />
            ))}
          </Box>
        )}

        {hasNextPage && (
          <Box
            ref={loadMoreRef}
            sx={{ display: "flex", justifyContent: "center", py: 2 }}
          >
            {isFetchingNextPage && <CircularProgress size={24} />}
          </Box>
        )}

        {!hasNextPage && communities.length > 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ mt: 2 }}
          >
            No more communities to load.
          </Typography>
        )}

        {communities.length === 0 && !isLoading && (
          <Typography variant="body1" align="center" sx={{ mt: 4 }}>
            {tabValue === 0
              ? "No communities found."
              : "You haven't joined any communities yet."}
          </Typography>
        )}

        <CreateCommunityModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </Container>
    </>
  );
};

export default Communities;
