import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('programs');
export const generateMetadata = route.generateMetadata;
export default route.Page;
