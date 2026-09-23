import { Navigate } from "react-router-dom";
import { LoadingSpinner } from "./LoadingSpinner";
import { useAuth } from "../hooks/context/useAuth";
import { AdminUserDTO, IUser } from "../types";

/* 
  'user is AdminUserDTO' is a type predicate signature that tells TS "if this fn returns true, 
  then user is definitely AdminUserDTO"
*/
function isAdminUser(user: IUser | null): user is AdminUserDTO {
	/*
    Check if user exists and has the isAdmin property (which only AdminUserDTO has)
    This safely checks the type union without casting
   */
	return !!user && "isAdmin" in user && user.isAdmin === true;
}

export const AdminRoute = ({ element }: { element: JSX.Element }) => {
	const { user, loading } = useAuth();

	if (loading) return <LoadingSpinner />;

	if (!isAdminUser(user)) {
		return <Navigate to="/login" />;
	}

	return element;
};
