import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('program-actions');
export const generateMetadata = route.generateMetadata;
export default route.Page;
