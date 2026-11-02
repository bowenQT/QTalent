import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('review-guide');
export const generateMetadata = route.generateMetadata;
export default route.Page;
