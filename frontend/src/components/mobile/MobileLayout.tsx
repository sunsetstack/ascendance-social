import React, { lazy, Suspense, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import MobileHeader from "./MobileHeader";
import MobileFAB from "./MobileFAB";
import BottomNav from "../BottomNav";
import { useSwipeDrawer } from "../../hooks/useSwipeDrawer";
import { useAuth } from "../../hooks/context/useAuth";
import { BottomNavProvider } from "../../context/BottomNav/BottomNavProvider";

const MobileDrawer = lazy(() => import("./MobileDrawer"));
const UploadForm = lazy(() => import("../UploadForm"));

const MobileLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoggedIn } = useAuth();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const {
    isOpen: isDrawerOpen,
    close: closeDrawer,
    toggle: toggleDrawer,
    drawerRef,
    backdropRef,
    dragOffset,
    isDragging,
  } = useSwipeDrawer();

  // pages where FAB should be hidden
  const isMessagesPage = location.pathname.startsWith("/messages");
  const isNotificationsPage = location.pathname.startsWith("/notifications");
  const showFAB = isLoggedIn && !isMessagesPage && !isNotificationsPage;

  const handleOpenUploadModal = () => {
    if (!user) {
      navigate("/login");
      return;
    }
    setIsUploadModalOpen(true);
  };

  const handleCloseUploadModal = () => setIsUploadModalOpen(false);

  return (
    <BottomNavProvider>
      <Box
        sx={{
          minHeight: "100dvh",
          height: isMessagesPage ? "100dvh" : "auto",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.default",
          // clip drawer animation overflow without creating a scroll container.
          overflowX: "clip",
          overflowY: "visible",
          "@supports not (min-height: 100dvh)": {
            minHeight: "100vh",
            height: isMessagesPage ? "100vh" : "auto",
          },
        }}
      >
        {/* persistent header */}
        <MobileHeader onMenuClick={toggleDrawer} />

        {/* swipeable drawer */}
        {(isDrawerOpen || isDragging) && (
          <Suspense fallback={null}>
            <MobileDrawer
              isOpen={isDrawerOpen}
              onClose={closeDrawer}
              drawerRef={drawerRef}
              backdropRef={backdropRef}
              dragOffset={dragOffset}
              isDragging={isDragging}
            />
          </Suspense>
        )}

        {/* main content area */}
        <Box
          component="main"
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            // messages page handles its own scroll, others can overflow
            overflow: isMessagesPage ? "hidden" : "visible",
            // reserve space for the fixed navigation and, when present, the FAB
            pb: showFAB
              ? "calc(144px + env(safe-area-inset-bottom))"
              : "calc(56px + env(safe-area-inset-bottom))",
          }}
        >
          <Outlet />
        </Box>

        {/* persistent FAB */}
        {showFAB && <MobileFAB onClick={handleOpenUploadModal} />}

        {/* persistent primary navigation */}
        <BottomNav />

        {/* upload modal */}
        {isUploadModalOpen && (
          <Suspense fallback={null}>
            <UploadForm onClose={handleCloseUploadModal} />
          </Suspense>
        )}
      </Box>
    </BottomNavProvider>
  );
};

export default MobileLayout;
