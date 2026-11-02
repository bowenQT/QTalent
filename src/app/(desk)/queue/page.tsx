import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('queue');
export const generateMetadata = route.generateMetadata;
export default route.Page;
