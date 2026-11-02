import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('tags');
export const generateMetadata = route.generateMetadata;
export default route.Page;
