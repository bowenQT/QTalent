import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('reviews');
export const generateMetadata = route.generateMetadata;
export default route.Page;
